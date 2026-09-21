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
import { CaptchaDetectedError, isCaptchaPage } from "./captcha";
import { getNextPageUrl, parseSearchPage, parseVacancyPage } from "./parser";

const HH_SEARCH_URL = "https://hh.ru/search/vacancy";

/**
 * Формирует URL поисковой выдачи hh.ru из параметров.
 */
export function buildSearchUrl(options: HhSearchOptions, page = 0): string {
  const params = new URLSearchParams({
    area: String(options.area ?? 113),
    per_page: "20",
    page: String(page),
    // Сортировка по дате публикации — свежие вакансии должны попадать в
    // начало очереди на скрапинг раньше более старых.
    order_by: "publication_time",
  });

  if (options.keyword) params.set("text", options.keyword);
  for (const roleId of options.professionalRoles ?? []) {
    params.append("professional_role", roleId);
  }

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
  let duplicatesTouched = 0;
  let captchaError: CaptchaDetectedError | null = null;
  const { onVacancy, isKnownVacancy, onDuplicateVacancy } = options;

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
    // Базовые 60с на парсинг страницы + запас на все попытки переждать
    // капчу (captchaMaxAttempts × captchaWaitMs), иначе crawlee оборвёт
    // обработчик по таймауту раньше, чем мы успеем дождаться разблокировки.
    requestHandlerTimeoutSecs:
      60 +
      Math.ceil(
        (config.captchaMaxAttempts * (config.captchaWaitMs + 60_000)) / 1000,
      ),

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
      // hh.ru может показать антибот-капчу вместо любой страницы (и выдачи,
      // и вакансии). Обычно блокировка временная — ждём и пробуем ту же
      // страницу снова; если капча не проходит после нескольких попыток,
      // останавливаем весь прогон совсем (дальше ждать бессмысленно).
      if (await isCaptchaPage(page)) {
        let stillBlocked = true;
        for (let attempt = 1; attempt <= config.captchaMaxAttempts; attempt++) {
          log.warning(
            `hh.ru показал капчу, жду ${Math.round(config.captchaWaitMs / 1000)}с и пробую снова (${attempt}/${config.captchaMaxAttempts})`,
            { url: request.url },
          );
          await page.waitForTimeout(config.captchaWaitMs);
          await page.reload({ waitUntil: "domcontentloaded", timeout: 60_000 });
          if (!(await isCaptchaPage(page))) {
            stillBlocked = false;
            log.info("Капча прошла, продолжаю скрапинг", {
              url: request.url,
            });
            break;
          }
        }

        if (stillBlocked) {
          captchaError = new CaptchaDetectedError(request.url);
          log.error(
            "hh.ru всё ещё показывает капчу после нескольких попыток — останавливаю скрапинг",
            { url: request.url },
          );
          crawler.stop("captcha-still-blocked");
          return;
        }
      }

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

        // Ставим в очередь страницы каждой вакансии — кроме уже известных
        // (isKnownVacancy), чтобы не открывать повторно то, что уже
        // скрапили раньше.
        for (const s of found) {
          if (!s.hhId) continue;
          if (isKnownVacancy && (await isKnownVacancy(s.hhId))) {
            duplicatesTouched++;
            if (onDuplicateVacancy) await onDuplicateVacancy(s);
            continue;
          }
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
          log.error(`Ошибка парсинга вакансии ${hhId}`, {
            error: { message: msg },
          });
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

  if (captchaError) {
    throw captchaError;
  }

  return {
    keyword:
      options.keyword ??
      `professional_role:${(options.professionalRoles ?? []).join(",")}`,
    vacancies,
    pagesScraped,
    errors,
    duplicatesTouched,
  };
}
