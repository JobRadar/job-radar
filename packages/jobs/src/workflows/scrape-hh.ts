import { eq } from "@job-radar/db";
import { db } from "@job-radar/db/client";
import { ScrapeRun, SearchKeyword } from "@job-radar/db/schema";
import type { WorkFormat } from "@job-radar/scraper";
import { hatchet } from "../client";
import {
  archiveStaleVacancies as archiveStaleVacanciesCore,
  scrapeAndSaveKeyword,
} from "../scrape-hh-core";

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

    if (!keyword.keyword && !keyword.professionalRoles?.length) {
      throw new Error(
        `SearchKeyword ${input.keywordId} не содержит ни keyword, ни professionalRoles`,
      );
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
      ? workFormatRaw
          .split(",")
          .map((v) => v.trim())
          .filter((v): v is WorkFormat => ALLOWED.has(v))
      : undefined;

    return {
      scrapeRunId: scrapeRun.id,
      keywordId: keyword.id,
      categoryId: keyword.categoryId ?? undefined,
      keyword: keyword.keyword ?? undefined,
      professionalRoles: keyword.professionalRoles ?? undefined,
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
      professionalRoles,
      area,
      experience,
      employment,
      workFormat,
      maxPages,
    } = await ctx.parentOutput(initRun);

    const { vacanciesFound, vacanciesNew, errors } = await scrapeAndSaveKeyword(
      {
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
      },
    );

    return {
      scrapeRunId,
      keywordId,
      vacanciesFound,
      vacanciesNew,
      errors,
    };
  },
});

// ── Шаг 3: авто-архивация протухших вакансий ──────────────────────────────
// Вакансия, которая не встретилась в свежем скрапинге этого keyword дольше
// HH_VACANCY_STALE_DAYS дней, считается закрытой на hh.ru и помечается
// isArchived=true. Порог должен быть заметно больше интервала cron-запуска
// (по умолчанию каждые 6 часов), чтобы не архивировать вакансии из-за
// единичного сбойного прогона.
const archiveStaleVacancies = scrapeHhWorkflow.task({
  name: "archive-stale-vacancies",
  parents: [scrapeAndSave],
  retries: 1,
  executionTimeout: "1m",
  fn: async (_rawInput, ctx) => {
    const { keywordId } = await ctx.parentOutput(scrapeAndSave);
    return archiveStaleVacanciesCore(keywordId);
  },
});

// ── Шаг 4: финализация ────────────────────────────────────────────────────
scrapeHhWorkflow.task({
  name: "finalize",
  parents: [scrapeAndSave, archiveStaleVacancies],
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
