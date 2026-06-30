import type { PlaywrightCrawlingContext } from "crawlee";
import { Configuration, PlaywrightCrawler, RequestQueue } from "crawlee";
import type { Cookie } from "playwright";
import type { ScraperConfig } from "../config";
import type {
  HhSearchOptions,
  ScrapedVacancyDetails,
  ScrapedVacancySummary,
  ScrapeResult,
} from "../types";
import { getNextPageUrl, parseSearchPage, parseVacancyPage } from "./parser";

const HH_SEARCH_URL = "https://hh.ru/search/vacancy";

/**
 * Формирует URL поисковой выдачи hh.ru из параметров.
 */
export function buildSearchUrl(options: HhSearchOptions, page = 0): string {
  const params = new URLSearchParams({
    text: options.keyword,
    area: String(options.area ?? 113),
    per_page: "20",
    page: String(page),
  });

  if (options.salaryFrom) params.set("salary", String(options.salaryFrom));
  if (options.experience) params.set("experience", options.experience);
  if (options.employment) params.set("employment", options.employment);
  if (options.workFormat?.length) {
    params.set("work_format", options.workFormat.join(","));
  }

  return `${HH_SEARCH_URL}?${params.toString()}`;
}

/** Метки типа запроса для маршрутизации в crawler */
const LABEL = {
  SEARCH: "SEARCH",
  VACANCY: "VACANCY",
} as const;

/**
 * Запускает скрапинг вакансий по ключевому слову.
 *
 * Алгоритм:
 * 1. Обходит страницы поисковой выдачи (до maxPages).
 * 2. Для каждой карточки открывает страницу вакансии и парсит детали.
 * 3. Возвращает массив полных данных по вакансиям.
 */
export async function searchVacancies(
  options: HhSearchOptions,
  config: ScraperConfig,
  cookies: Cookie[] = [],
): Promise<ScrapeResult> {
  const maxPages = options.maxPages ?? 5;
  const vacancies: ScrapedVacancyDetails[] = [];
  const summaries = new Map<string, ScrapedVacancySummary>();
  const errors: string[] = [];
  let pagesScraped = 0;
  const { onVacancy } = options;

  // Изолируем хранилище crawlee для каждого запуска
  const storageDir = `${config.storageDir}/${Date.now()}`;
  Configuration.getGlobalConfig().set("storageClientOptions", {
    localDataDirectory: storageDir,
  });

  const queue = await RequestQueue.open();

  await queue.addRequest({
    url: buildSearchUrl(options, 0),
    label: LABEL.SEARCH,
    userData: { page: 0 },
  });

  const crawler = new PlaywrightCrawler({
    requestQueue: queue,
    maxConcurrency: config.maxConcurrency,
    maxRequestRetries: config.maxRetries,
    minConcurrency: 1,
    requestHandlerTimeoutSecs: 60,

    launchContext: {
      launchOptions: {
        headless: config.headless,
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
      },
    },

    // Применяем cookies перед каждой навигацией
    preNavigationHooks: [
      async ({ page }: PlaywrightCrawlingContext) => {
        if (cookies.length > 0) {
          await page.context().addCookies(cookies);
        }
        // Рандомная задержка — снижает вероятность блокировки
        const [min, max] = config.requestDelay;
        await page.waitForTimeout(min + Math.random() * (max - min));
      },
    ],

    requestHandler: async ({
      page,
      request,
      log,
    }: PlaywrightCrawlingContext) => {
      const label = request.label as keyof typeof LABEL | undefined;

      // ── Страница поисковой выдачи ──────────────────────────────────────────
      if (label === LABEL.SEARCH) {
        pagesScraped++;
        log.info(`Поиск: страница ${pagesScraped}`, { url: request.url });

        // Поддерживаем оба дизайна hh.ru: старый (bloko) и новый (Magritte)
        await page.waitForSelector(
          [
            '[data-qa="vacancy-serp__vacancy"]',
            ".vacancy-serp-item__layout",
            'a[data-qa="serp-item__title"]',
          ].join(", "),
          { timeout: 15_000 },
        );

        const found = await parseSearchPage(page);
        for (const s of found) {
          if (s.hhId) summaries.set(s.hhId, s);
        }

        // Пагинация
        if (pagesScraped < maxPages) {
          const nextUrl = await getNextPageUrl(page);
          if (nextUrl) {
            await queue.addRequest({
              url: nextUrl,
              label: LABEL.SEARCH,
              userData: { page: pagesScraped },
            });
          }
        }

        // Ставим в очередь страницы каждой вакансии
        for (const s of found) {
          if (!s.hhId) continue;
          await queue.addRequest({
            url: s.url,
            label: LABEL.VACANCY,
            userData: { hhId: s.hhId },
            uniqueKey: `vacancy-${s.hhId}`,
          });
        }
        return;
      }

      // ── Страница вакансии ──────────────────────────────────────────────────
      if (label === LABEL.VACANCY) {
        const hhId = request.userData.hhId as string;
        const summary = summaries.get(hhId);
        if (!summary) return;

        log.info(`Парсинг вакансии ${hhId}`, { title: summary.title });

        await page.waitForSelector('[data-qa="vacancy-title"]', {
          timeout: 10_000,
        });

        try {
          const details = await parseVacancyPage(page, summary);
          vacancies.push(details);
          if (onVacancy) await onVacancy(details);
        } catch (err) {
          const msg = err instanceof Error ? err.message : JSON.stringify(err);
          errors.push(`Ошибка парсинга вакансии ${hhId}: ${msg}`);
          log.error(`Ошибка парсинга вакансии ${hhId}`, { error: { message: msg } });
          const fallback: ScrapedVacancyDetails = {
            ...summary,
            description: null,
            hiringFormats: [],
            skills: [],
            experience: null,
            employment: null,
            schedule: null,
            employerLogoUrl: null,
            employerUrl: null,
          };
          vacancies.push(fallback);
          if (onVacancy) await onVacancy(fallback);
        }
      }
    },

    failedRequestHandler: async ({
      request,
      log,
    }: PlaywrightCrawlingContext) => {
      const msg = `Не удалось загрузить ${request.url} (${request.retryCount} попыток)`;
      errors.push(msg);
      log.error(msg);
    },
  });

  await crawler.run();

  return {
    keyword: options.keyword,
    vacancies,
    pagesScraped,
    errors,
  };
}
