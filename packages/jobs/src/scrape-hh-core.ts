import { and, eq, lt } from "@job-radar/db";
import { db } from "@job-radar/db/client";
import { ScrapeRun, Vacancy } from "@job-radar/db/schema";
import {
  getScraperConfig,
  resolveCookies,
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

  const upsertVacancy = async (v: (typeof result.vacancies)[number]) => {
    if (!v.hhId) return;
    const existing = await db.query.Vacancy.findFirst({
      where: eq(Vacancy.hhId, v.hhId),
      columns: { id: true },
    });
    if (existing) {
      await db
        .update(Vacancy)
        .set({
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
          categoryId: categoryId ?? undefined,
          publishedAt: v.publishedAt ?? undefined,
          isArchived: false,
          lastSeenAt: new Date(),
        })
        .where(eq(Vacancy.hhId, v.hhId));
    } else {
      await db.insert(Vacancy).values({
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
      });
    }
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
      onVacancy: upsertVacancy,
    },
    { ...config, headless: true },
    cookies,
  );

  let vacanciesNew = 0;
  for (const v of result.vacancies) {
    if (!v.hhId) continue;
    const existing = await db.query.Vacancy.findFirst({
      where: eq(Vacancy.hhId, v.hhId),
      columns: { id: true },
    });
    if (!existing) vacanciesNew++;
  }

  await db
    .update(ScrapeRun)
    .set({
      vacanciesFound: result.vacancies.length,
      vacanciesNew,
      error: result.errors.length > 0 ? result.errors.join("\n") : undefined,
    })
    .where(eq(ScrapeRun.id, scrapeRunId));

  return {
    vacanciesFound: result.vacancies.length,
    vacanciesNew,
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
