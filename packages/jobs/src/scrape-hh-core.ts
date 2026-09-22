import { and, eq, lt } from "@job-radar/db";
import { db } from "@job-radar/db/client";
import { ScrapeRun, Vacancy } from "@job-radar/db/schema";
import {
  getScraperConfig,
  resolveCookies,
  type ScrapedVacancySummary,
  searchVacancies,
  type WorkFormat,
} from "@job-radar/scraper";

/**
 * Общая логика скрапинга + сохранения вакансий hh.ru для одного
 * SearchKeyword. Не зависит от Hatchet — используется и Hatchet task'ом
 * `scrape-and-save` (см. `workflows/scrape-hh.ts`), и локальным CLI-скриптом
 * `scrape-local.ts`, который запускает скрапинг напрямую, без воркера.
 */
export interface ScrapeKeywordParams {
  scrapeRunId: string;
  keywordId: string;
  categoryId?: string;
  keyword?: string;
  professionalRoles?: string[];
  area?: number;
  experience?: string;
  employment?: string;
  workFormat?: WorkFormat[];
  maxPages?: number;
}

export interface ScrapeKeywordResult {
  vacanciesFound: number;
  vacanciesNew: number;
  /** Уже были в БД — detail-страница повторно не открывалась, обновили lastSeenAt */
  vacanciesTouched: number;
  errors: string[];
}

export async function scrapeAndSaveKeyword(
  params: ScrapeKeywordParams,
): Promise<ScrapeKeywordResult> {
  const {
    scrapeRunId,
    keywordId,
    categoryId,
    keyword,
    professionalRoles,
    area,
    experience,
    employment,
    workFormat,
    maxPages,
  } = params;

  const config = getScraperConfig();

  const credentials =
    process.env.HH_PHONE && process.env.HH_PASSWORD
      ? { phone: process.env.HH_PHONE, password: process.env.HH_PASSWORD }
      : undefined;

  const cookies = await resolveCookies({
    cookiesPath: config.cookiesPath,
    credentials,
    headless: true,
  });

  // Уже видели эту вакансию раньше? Тогда searchVacancies не станет
  // повторно открывать её detail-страницу — только вызовет
  // onDuplicateVacancy с данными из карточки выдачи.
  const isKnownVacancy = async (hhId: string) => {
    const existing = await db.query.Vacancy.findFirst({
      where: eq(Vacancy.hhId, hhId),
      columns: { id: true },
    });
    return existing !== undefined;
  };

  // Для уже известных вакансий обновляем то, что видно прямо в карточке
  // выдачи (без похода на detail-страницу) — и отмечаем, что вакансия
  // всё ещё активна.
  const onDuplicateVacancy = async (s: ScrapedVacancySummary) => {
    await db
      .update(Vacancy)
      .set({
        title: s.title,
        employerName: s.employerName ?? undefined,
        salary: s.salary ?? undefined,
        area: s.area ?? undefined,
        isArchived: false,
        lastSeenAt: new Date(),
      })
      .where(eq(Vacancy.hhId, s.hhId));
  };

  // isKnownVacancy отсеивает большинство уже известных вакансий, но не
  // защищает от гонки: одна и та же вакансия может найтись параллельно по
  // двум разным keyword раньше, чем первая успеет записаться в БД. Поэтому
  // вместо plain insert делаем upsert по hh_id (уникальному) — второй
  // "insert" той же вакансии просто обновит запись вместо падения с
  // ошибкой уникальности.
  const insertVacancy = async (v: (typeof result.vacancies)[number]) => {
    if (!v.hhId) return;
    const values = {
      hhId: v.hhId,
      keywordId,
      categoryId: categoryId ?? undefined,
      title: v.title,
      employerName: v.employerName ?? undefined,
      employerUrl: v.employerUrl ?? undefined,
      employerLogoUrl: v.employerLogoUrl ?? undefined,
      salary: v.salary ?? undefined,
      area: v.area ?? undefined,
      experience: v.experience ?? undefined,
      employment: v.employment ?? undefined,
      schedule: v.schedule ?? undefined,
      description: v.description ?? undefined,
      skills: v.skills,
      url: v.url,
      publishedAt: v.publishedAt ?? undefined,
      lastSeenAt: new Date(),
      isArchived: false,
    };
    await db
      .insert(Vacancy)
      .values(values)
      .onConflictDoUpdate({ target: Vacancy.hhId, set: values });
  };

  const result = await searchVacancies(
    {
      keyword,
      professionalRoles,
      area: area ?? 113,
      experience: experience ?? undefined,
      employment: employment ?? undefined,
      workFormat,
      maxPages: maxPages ?? Number(process.env.HH_SCRAPER_MAX_PAGES ?? "5"),
      onVacancy: insertVacancy,
      isKnownVacancy,
      onDuplicateVacancy,
    },
    { ...config, headless: true },
    cookies,
  );

  const vacanciesNew = result.vacancies.length;
  const vacanciesFound = vacanciesNew + result.duplicatesTouched;

  await db
    .update(ScrapeRun)
    .set({
      vacanciesFound,
      vacanciesNew,
      error: result.errors.length > 0 ? result.errors.join("\n") : undefined,
    })
    .where(eq(ScrapeRun.id, scrapeRunId));

  return {
    vacanciesFound,
    vacanciesNew,
    vacanciesTouched: result.duplicatesTouched,
    errors: result.errors,
  };
}

/**
 * Авто-архивация вакансий, не встретившихся в свежем скрапинге этого
 * keyword дольше HH_VACANCY_STALE_DAYS дней (считаем их закрытыми на hh.ru).
 */
export async function archiveStaleVacancies(
  keywordId: string,
): Promise<{ archivedCount: number }> {
  const staleDays = Number(process.env.HH_VACANCY_STALE_DAYS ?? "3");
  const staleBefore = new Date(Date.now() - staleDays * 24 * 60 * 60 * 1000);

  const archived = await db
    .update(Vacancy)
    .set({ isArchived: true })
    .where(
      and(
        eq(Vacancy.keywordId, keywordId),
        eq(Vacancy.isArchived, false),
        lt(Vacancy.lastSeenAt, staleBefore),
      ),
    )
    .returning({ id: Vacancy.id });

  return { archivedCount: archived.length };
}
