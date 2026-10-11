import { setTimeout as sleep } from "node:timers/promises";
import { type CheerioAPI, load } from "cheerio";
import type { CheerioCrawlingContext, Session } from "crawlee";
import { CheerioCrawler, Configuration, RequestQueue } from "crawlee";
import type { Cookie } from "playwright";
import type { ScraperConfig } from "../config";
import type {
  HhSearchOptions,
  ScrapedVacancyDetails,
  ScrapedVacancySummary,
  ScrapeResult,
} from "../types";
import { saveCookies } from "./auth";
import {
  BrowserCaptchaResolver,
  CaptchaDetectedError,
  isCaptchaHtml,
} from "./captcha";
import { parseNextPageUrl, parseSearchHtml, parseVacancyHtml } from "./parser";

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

/** Коды ответа, с которыми hh.ru может не пустить HTTP-запрос */
const BLOCKED_STATUS_CODES = [403, 429];

/**
 * Кладёт cookies hh.ru в cookie jar сессии crawlee. Через сессию, а не
 * заголовком Cookie: заголовок got теряет на редиректе на региональный
 * поддомен (hh.ru → volokolamsk.hh.ru), а cookies сессии — нет.
 */
function seedSessionCookies(session: Session, cookies: Cookie[]): void {
  for (const cookie of cookies) {
    const host = cookie.domain.replace(/^\./, "");
    session.setCookies([cookie], `https://${host}${cookie.path || "/"}`);
  }
}

/**
 * Запускает скрапинг вакансий по ключевому слову.
 *
 * Алгоритм:
 * 1. Обходит страницы поисковой выдачи (до maxPages).
 * 2. Для каждой карточки загружает страницу вакансии и парсит детали.
 * 3. Возвращает массив полных данных по вакансиям.
 *
 * Страницы загружаются обычными HTTP-запросами — hh.ru отдаёт их уже
 * отрендеренными на сервере, браузер для парсинга не нужен. Браузер
 * открывается только если hh.ru показал капчу (см. BrowserCaptchaResolver).
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

  // После капчи hh.ru выдаёт новые cookies — их версия растёт, и каждая
  // сессия crawlee при следующем запросе получает актуальный набор.
  let currentCookies = cookies;
  let cookiesVersion = 0;
  const seededVersion = new WeakMap<Session, number>();
  const captchaResolver = new BrowserCaptchaResolver(config, cookies);

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

  const crawler = new CheerioCrawler({
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

    // Одна сессия на весь прогон — как один и тот же браузер: постоянные
    // заголовки и cookies. 403/429 не считаем «сессия заблокирована» —
    // такие ответы разбирает requestHandler (капча → браузер).
    sessionPoolOptions: {
      maxPoolSize: 1,
      blockedStatusCodes: [],
      sessionOptions: { maxUsageCount: Number.MAX_SAFE_INTEGER },
    },

    preNavigationHooks: [
      async ({ session }: CheerioCrawlingContext) => {
        if (session && seededVersion.get(session) !== cookiesVersion) {
          seedSessionCookies(session, currentCookies);
          seededVersion.set(session, cookiesVersion);
        }
        // Рандомная задержка — снижает вероятность блокировки
        const [min, max] = config.requestDelay;
        await sleep(min + Math.random() * (max - min));
      },
    ],

    requestHandler: async ({
      $: responseHtml,
      request,
      response,
      log,
    }: CheerioCrawlingContext) => {
      const pageUrl = request.loadedUrl ?? request.url;
      let $: CheerioAPI = responseHtml;

      // hh.ru может показать антибот-капчу вместо любой страницы (и выдачи,
      // и вакансии). Тогда открываем её в браузере и ждём, пока капчу
      // решат или блокировка истечёт; если не дождались — останавливаем
      // весь прогон совсем (дальше ждать бессмысленно).
      if (
        isCaptchaHtml($) ||
        BLOCKED_STATUS_CODES.includes(response.statusCode ?? 0)
      ) {
        log.warning(
          `hh.ru не пускает (капча или HTTP ${response.statusCode}) — открываю страницу в браузере`,
          { url: request.url },
        );
        const resolved = await captchaResolver.resolve(request.url);
        if (!resolved) {
          captchaError = new CaptchaDetectedError(request.url);
          log.error(
            "hh.ru всё ещё показывает капчу после нескольких попыток — останавливаю скрапинг",
            { url: request.url },
          );
          crawler.stop("captcha-still-blocked");
          return;
        }

        currentCookies = resolved.cookies.filter((c) =>
          c.domain.endsWith("hh.ru"),
        );
        cookiesVersion++;
        // Сохраняем, чтобы следующий прогон сразу шёл с этими cookies
        saveCookies(config.cookiesPath, currentCookies);
        log.info("Капча прошла, продолжаю скрапинг", { url: request.url });
        $ = load(resolved.html);
      }

      const label = request.label as keyof typeof LABEL | undefined;

      // ── Страница поисковой выдачи ──────────────────────────────────────────
      if (label === LABEL.SEARCH) {
        const found = parseSearchHtml($, pageUrl);
        // Нет карточек — скорее всего, hh.ru отдал не ту страницу; падаем,
        // чтобы crawlee повторил запрос (раньше это был таймаут ожидания
        // селектора карточек).
        if (found.length === 0) {
          throw new Error("На странице выдачи не нашлось карточек вакансий");
        }

        pagesScraped++;
        log.info(`Поиск: страница ${pagesScraped}`, { url: request.url });

        for (const s of found) {
          if (s.hhId) summaries.set(s.hhId, s);
        }

        // Пагинация
        if (pagesScraped < maxPages) {
          const nextUrl = parseNextPageUrl($, pageUrl);
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

        if ($('[data-qa="vacancy-title"]').length === 0) {
          throw new Error(`На странице вакансии ${hhId} нет заголовка`);
        }

        try {
          const details = parseVacancyHtml($, summary, pageUrl);
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

    failedRequestHandler: async ({ request, log }: CheerioCrawlingContext) => {
      const msg = `Не удалось загрузить ${request.url} (${request.retryCount} попыток)`;
      errors.push(msg);
      log.error(msg);
    },
  });

  try {
    await crawler.run();
  } finally {
    await captchaResolver.close();
  }

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
