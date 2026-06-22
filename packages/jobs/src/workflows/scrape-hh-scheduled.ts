import { eq } from "@job-radar/db";
import { db } from "@job-radar/db/client";
import { SearchKeyword } from "@job-radar/db/schema";
import { hatchet } from "../client";
import { scrapeHhWorkflow } from "./scrape-hh";

/**
 * Cron-workflow: каждые 6 часов запускает скрапинг
 * для всех активных ключевых слов во всех аккаунтах.
 *
 * Расписание меняется через переменную HH_SCRAPER_CRON.
 * По умолчанию: каждые 6 часов.
 *
 * @see https://docs.hatchet.run/home/triggers#cron-triggers
 */
export const scrapeHhScheduledWorkflow = hatchet.workflow({
  name: "scrape-hh-scheduled",
  on: {
    cron: process.env.HH_SCRAPER_CRON ?? "0 */6 * * *",
  },
});

scrapeHhScheduledWorkflow.task({
  name: "dispatch-keyword-runs",
  retries: 1,
  executionTimeout: "2m",
  fn: async () => {
    // Загружаем все активные ключевые слова
    const keywords = await db
      .select({ id: SearchKeyword.id, keyword: SearchKeyword.keyword })
      .from(SearchKeyword)
      .where(eq(SearchKeyword.isActive, true));

    if (keywords.length === 0) {
      return { dispatched: 0, message: "Нет активных ключевых слов" };
    }

    // Запускаем отдельный workflow для каждого ключевого слова
    const runs = await Promise.all(
      keywords.map((kw) => scrapeHhWorkflow.run({ keywordId: kw.id })),
    );

    return {
      dispatched: runs.length,
      keywords: keywords.map((kw) => kw.keyword),
    };
  },
});
