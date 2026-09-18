import { hatchet } from "./client";
import type { ScrapeHhInput } from "./workflows/scrape-hh";

/**
 * Имя workflow скрапинга hh.ru (см. `scrapeHhWorkflow`).
 * Держим строкой, чтобы триггерить прогон, не импортируя само определение
 * workflow (а вместе с ним тяжёлый `@job-radar/scraper` + Playwright).
 */
const SCRAPE_HH_WORKFLOW = "scrape-hh";

/**
 * Запустить прогон скрапинга hh.ru по имени workflow.
 *
 * Используется из веб-приложения (oRPC), которое работает в рантайме Next.js —
 * там нельзя тянуть Playwright. Поэтому триггерим прогон через Hatchet admin
 * API по имени, а реальная работа выполняется в worker-процессе.
 *
 * @returns id созданного прогона workflow
 */
export async function triggerScrapeHh(input: ScrapeHhInput): Promise<string> {
  const ref = await hatchet.admin.runWorkflow(SCRAPE_HH_WORKFLOW, input);
  return ref.getWorkflowRunId();
}
