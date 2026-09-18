import { logger } from "@job-radar/config";
import type {
  HhSearchOptions,
  ScrapedVacancyDetails,
} from "@job-radar/scraper";
import {
  buildSearchUrl,
  getScraperConfig,
  parseSearchPage,
  parseVacancyPage,
  resolveCookies,
} from "@job-radar/scraper";
import { type Browser, type Cookie, chromium, type Page } from "playwright";

// User-Agent реального браузера для маскировки
const DESKTOP_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

// Рандомная задержка между запросами (имитация пользователя)
function humanDelay(minMs = 1500, maxMs = 4000): Promise<void> {
  const ms = minMs + Math.random() * (maxMs - minMs);
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Рандомное число для пауз скролла
function scrollDelay(): Promise<void> {
  return humanDelay(300, 800);
}

/**
 * CLI-скрипт для тестирования скрапинга вакансий hh.ru.
 *
 * Использует ТЕ ЖЕ функции парсинга что и Hatchet workflow:
 * - parseSearchPage, parseVacancyPage, buildSearchUrl, getNextPageUrl
 *
 * По умолчанию парсит ТОЛЬКО ПЕРВУЮ вакансию для быстрого демо.
 * Включает защиту от блокировок: рандомные задержки, имитация скролла,
 * сброс webdriver detection и прочее.
 *
 * Запуск:
 *   bun test-search --keyword="Удалённый менеджер" --area=113
 *   bun test-search --keyword="Frontend" --max-pages=2
 */

interface CliArgs {
  keyword: string;
  area: number;
  maxPages: number;
  headless: boolean;
  /** Сохранить результат в JSON-файл */
  outputFile?: string;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  const get = (flag: string, fallback?: string) => {
    const hit = args.find((a) => a.startsWith(`${flag}=`));
    return hit ? hit.slice(flag.length + 1) : fallback;
  };
  const has = (flag: string) => args.includes(flag);

  return {
    keyword: get("--keyword", "Удалённый") ?? "Удалённый",
    area: Number(get("--area", "113") ?? "113"),
    maxPages: Number(get("--max-pages", "1") ?? "1"),
    headless: has("--headless") || has("-h"),
    outputFile: get("--output"),
  };
}

interface ScrapeResult {
  keyword: string;
  vacancies: ScrapedVacancyDetails[];
  pagesScraped: number;
  errors: string[];
}

async function scrapeFirstVacancy(
  options: HhSearchOptions,
  headless: boolean,
  cookies: Cookie[],
): Promise<ScrapeResult> {
  const vacancies: ScrapedVacancyDetails[] = [];
  const errors: string[] = [];

  const browser: Browser = await chromium.launch({
    headless,
    chromiumSandbox: false,
    args: [
      "--disable-blink-features=AutomationControlled",
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-accelerated-2d-canvas",
      "--no-first-run",
      "--no-zygote",
      "--disable-gpu",
      "--window-size=1366,900",
    ],
  });

  try {
    const context = await browser.newContext({
      locale: "ru-RU",
      viewport: { width: 1366, height: 900 },
      userAgent: DESKTOP_UA,
      ignoreHTTPSErrors: true,
    });

    if (cookies.length > 0) {
      await context.addCookies(
        cookies.map((c) => ({
          ...c,
          sameSite: c.sameSite ?? "Lax",
        })),
      );
    }

    const page: Page = await context.newPage();

    await page.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => false });
    });

    // Загружаем страницу поиска
    const searchUrl = buildSearchUrl(options, 0);
    logger.info("Загрузка страницы поиска", { url: searchUrl });

    await humanDelay();
    await page.goto(searchUrl, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });

    await page.evaluate(() => {
      window.scrollTo({ top: 0, behavior: "instant" });
    });
    await scrollDelay();
    await page.mouse.wheel(0, 300);
    await scrollDelay();
    await page.mouse.wheel(0, 500);
    await scrollDelay();

    await page.waitForSelector(
      '[data-qa="vacancy-serp__vacancy"], .vacancy-serp-item__layout, a[data-qa="serp-item__title"]',
      { timeout: 15_000 },
    );

    const found = await parseSearchPage(page);
    logger.info(`Найдено вакансий на странице: ${found.length}`);

    const first = found[0];
    if (first === undefined) {
      errors.push("На странице не найдено ни одной вакансии");
      return {
        keyword: options.keyword ?? "",
        vacancies,
        pagesScraped: 1,
        errors,
      };
    }
    logger.info(`Парсинг первой вакансии: ${first.hhId} — ${first.title}`);

    await humanDelay(800, 2000);
    await page.goto(first.url, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });

    await page.evaluate(() => {
      window.scrollTo({ top: 0, behavior: "instant" });
    });
    await scrollDelay();
    await page.mouse.wheel(0, 400);
    await scrollDelay();
    await page.mouse.wheel(0, 600);
    await scrollDelay();

    try {
      await page.waitForSelector('[data-qa="vacancy-title"]', {
        timeout: 10_000,
      });
      await Promise.all([
        page.waitForFunction(
          () => {
            const el = document.querySelector(
              '[data-qa="vacancy-description"]',
            );
            return el && (el.textContent?.trim()?.length ?? 0) > 10;
          },
          { timeout: 15_000 },
        ),
        page.waitForSelector('p[data-qa="work-formats-text"]', {
          timeout: 15_000,
        }),
      ]);
    } catch {
      errors.push(`Не удалось загрузить страницу вакансии ${first.hhId}`);
      vacancies.push({
        ...first,
        description: null,
        hiringFormats: [],
        skills: [],
        experience: null,
        employment: null,
        schedule: null,
        employerLogoUrl: null,
        employerUrl: null,
      });
      return {
        keyword: options.keyword ?? "",
        vacancies,
        pagesScraped: 1,
        errors,
      };
    }

    const details = await parseVacancyPage(page, first);
    vacancies.push(details);

    await context.close();
  } finally {
    await browser.close();
  }

  return { keyword: options.keyword ?? "", vacancies, pagesScraped: 1, errors };
}

async function main() {
  const config = getScraperConfig();
  const cli = parseArgs();

  logger.info("test-search: запуск", {
    headless: cli.headless,
    cookiesPath: config.cookiesPath,
    keyword: cli.keyword,
    area: cli.area,
    maxPages: cli.maxPages,
  });

  const searchOptions: HhSearchOptions = {
    keyword: cli.keyword,
    area: cli.area,
    maxPages: cli.maxPages,
  };

  if (!cli.headless) {
    console.log("\n🌐 Браузер будет ВИДЕН (headless выключен)");
    console.log("   Для headless запуска добавьте --headless или -h\n");
  }

  // 1) Получаем cookies (используем те же функции что и в Hatchet workflow)
  const credentials =
    process.env.HH_PHONE && process.env.HH_PASSWORD
      ? { phone: process.env.HH_PHONE, password: process.env.HH_PASSWORD }
      : undefined;

  const cookies = await resolveCookies({
    cookiesPath: config.cookiesPath,
    credentials,
    headless: cli.headless,
  }).catch((err) => {
    logger.error("Не удалось получить cookies", err);
    console.warn("⚠️  Продолжаем без cookies (анонимный режим)");
    return [] as Cookie[];
  });

  // 2) Парсим ТОЛЬКО первую вакансию для демо
  const result = await scrapeFirstVacancy(searchOptions, cli.headless, cookies);

  // 3) Выводим JSON со всеми полями ScrapedVacancyDetails
  if (result.vacancies.length > 0) {
    const v = result.vacancies[0];
    if (v !== undefined) {
      const output = {
        hhId: v.hhId,
        title: v.title,
        url: v.url,
        employerName: v.employerName,
        employerLogoUrl: v.employerLogoUrl,
        salary: v.salary,
        area: v.area,
        publishedAt: v.publishedAt,
        experience: v.experience,
        employment: v.employment,
        schedule: v.schedule,
        hiringFormats: v.hiringFormats,
        skills: v.skills,
        description: v.description,
      };
      console.log("\n" + JSON.stringify(output, null, 2));
    }
  } else if (result.errors.length > 0) {
    console.error("\nОшибки:", JSON.stringify(result.errors, null, 2));
  }

  // 4) Сохраняем в файл если указан
  if (cli.outputFile) {
    const fs = await import("fs/promises");
    await fs.writeFile(
      cli.outputFile,
      JSON.stringify(result, null, 2),
      "utf-8",
    );
    logger.info(`Результат сохранён в ${cli.outputFile}`);
    console.log(`\nРезультат сохранён в: ${cli.outputFile}`);
  }

  console.log("\nГотово!\n");
}

main().catch((err) => {
  console.error("\n❌ test-search провалился:", err);
  process.exit(1);
});
