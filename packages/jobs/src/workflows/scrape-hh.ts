import { eq } from "@job-radar/db";
import { db } from "@job-radar/db/client";
import { ScrapeRun, SearchKeyword, Vacancy } from "@job-radar/db/schema";
import {
  getScraperConfig,
  resolveCookies,
  searchVacancies,
  type WorkFormat,
} from "@job-radar/scraper";
import { hatchet } from "../client";

export interface ScrapeHhInput {
  /** UUID записи SearchKeyword — источник настроек поиска */
  keywordId: string;
  /**
   * Максимальное число страниц выдачи (20 вакансий / стр).
   * Если не указано — берётся из HH_SCRAPER_MAX_PAGES (по умолчанию 5).
   * Например, `maxPages: 1` — «последние 20 вакансий».
   */
  maxPages?: number;
}

/**
 * Workflow скрапинга вакансий hh.ru.
 *
 * DAG из трёх шагов:
 *  init-run  →  scrape-and-save  →  finalize
 *
 * Запустить вручную:
 * ```ts
 * import { scrapeHhWorkflow } from "@job-radar/jobs";
 * await scrapeHhWorkflow.run({ keywordId: "..." });
 * ```
 *
 * @see https://docs.hatchet.run/home/dag
 */
export const scrapeHhWorkflow = hatchet.workflow({
  name: "scrape-hh",
});

// ── Шаг 1: инициализация прогона ───────────────────────────────────────────
const initRun = scrapeHhWorkflow.task({
  name: "init-run",
  retries: 1,
  executionTimeout: "30s",
  fn: async (rawInput) => {
    const input = rawInput as unknown as ScrapeHhInput;

    // Загружаем настройки ключевого слова
    const keyword = await db.query.SearchKeyword.findFirst({
      where: eq(SearchKeyword.id, input.keywordId),
    });

    if (!keyword) {
      throw new Error(`SearchKeyword ${input.keywordId} не найден`);
    }

    if (!keyword.isActive) {
      throw new Error(`SearchKeyword ${input.keywordId} неактивен`);
    }

    // Создаём запись о текущем прогоне
    const [scrapeRun] = await db
      .insert(ScrapeRun)
      .values({
        keywordId: keyword.id,
        status: "running",
      })
      .returning({ id: ScrapeRun.id });

    if (!scrapeRun) {
      throw new Error("Не удалось создать запись ScrapeRun");
    }

    // Парсим CSV со списком форматов работы ("REMOTE,HYBRID").
    // Значения приходят из БД, куда попали через контролируемые валидаторы —
    // отфильтровываем всё, что не соответствует типу WorkFormat.
    const workFormatRaw = keyword.workFormat ?? null;
    const ALLOWED = new Set(["REMOTE", "OFFICE", "HYBRID", "FIELD_WORK"]);
    const workFormat: WorkFormat[] | undefined = workFormatRaw
      ? (workFormatRaw
          .split(",")
          .map((v) => v.trim())
          .filter((v): v is WorkFormat => ALLOWED.has(v)))
      : undefined;

    return {
      scrapeRunId: scrapeRun.id,
      keywordId: keyword.id,
      categoryId: keyword.categoryId ?? undefined,
      keyword: keyword.keyword,
      area: keyword.area,
      experience: keyword.experience ?? undefined,
      employment: keyword.employment ?? undefined,
      workFormat,
      maxPages: input.maxPages,
    };
  },
});

// ── Шаг 2: скрапинг и сохранение результатов ──────────────────────────────
const scrapeAndSave = scrapeHhWorkflow.task({
  name: "scrape-and-save",
  parents: [initRun],
  retries: 2,
  executionTimeout: "30m",
  fn: async (_rawInput, ctx) => {
    const {
      scrapeRunId,
      keywordId,
      categoryId,
      keyword,
      area,
      experience,
      employment,
      workFormat,
      maxPages,
    } = await ctx.parentOutput(initRun);

    const config = getScraperConfig();

    // Загружаем cookies авторизации (если настроены — входим, иначе аноним)
    const credentials =
      process.env.HH_PHONE && process.env.HH_PASSWORD
        ? { phone: process.env.HH_PHONE, password: process.env.HH_PASSWORD }
        : undefined;

    const cookies = await resolveCookies({
      cookiesPath: config.cookiesPath,
      credentials,
      headless: config.headless,
    });

    // Запускаем скрапинг
    const result = await searchVacancies(
      {
        keyword,
        area: area ?? 113,
        experience: experience ?? undefined,
        employment: employment ?? undefined,
        workFormat,
        maxPages: maxPages ?? Number(process.env.HH_SCRAPER_MAX_PAGES ?? "5"),
      },
      config,
      cookies,
    );

    // Upsert вакансий в БД
    let vacanciesNew = 0;
    for (const v of result.vacancies) {
      if (!v.hhId) continue;

      const existing = await db.query.Vacancy.findFirst({
        where: eq(Vacancy.hhId, v.hhId),
        columns: { id: true },
      });

      if (existing) {
        // Обновляем данные существующей вакансии (могли измениться условия)
        await db
          .update(Vacancy)
          .set({
            title: v.title,
            employerName: v.employerName ?? undefined,
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
          })
          .where(eq(Vacancy.hhId, v.hhId));
      } else {
        await db.insert(Vacancy).values({
          hhId: v.hhId,
          keywordId,
          categoryId: categoryId ?? undefined,
          title: v.title,
          employerName: v.employerName ?? undefined,
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
        });
        vacanciesNew++;
      }
    }

    // Обновляем прогон
    await db
      .update(ScrapeRun)
      .set({
        vacanciesFound: result.vacancies.length,
        vacanciesNew,
        error: result.errors.length > 0 ? result.errors.join("\n") : undefined,
      })
      .where(eq(ScrapeRun.id, scrapeRunId));

    return {
      scrapeRunId,
      vacanciesFound: result.vacancies.length,
      vacanciesNew,
      errors: result.errors,
    };
  },
});

// ── Шаг 3: финализация ────────────────────────────────────────────────────
scrapeHhWorkflow.task({
  name: "finalize",
  parents: [scrapeAndSave],
  retries: 1,
  executionTimeout: "15s",
  fn: async (_rawInput, ctx) => {
    const { scrapeRunId, vacanciesFound, vacanciesNew, errors } =
      await ctx.parentOutput(scrapeAndSave);

    const status = errors.length === 0 ? "completed" : "completed";

    await db
      .update(ScrapeRun)
      .set({
        status,
        completedAt: new Date(),
      })
      .where(eq(ScrapeRun.id, scrapeRunId));

    return {
      scrapeRunId,
      status,
      vacanciesFound,
      vacanciesNew,
    };
  },
});
