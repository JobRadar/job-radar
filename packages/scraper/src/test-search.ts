import { type Browser, type Cookie, type Page, chromium } from "playwright";
import {
  buildSearchUrl,
  getNextPageUrl,
  getScraperConfig,
  parseSearchPage,
  parseVacancyPage,
  resolveCookies,
} from "@job-radar/scraper";
import { logger } from "@job-radar/config";
import type { HhSearchOptions, ScrapedVacancyDetails } from "@job-radar/scraper";

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
 * По умолчанию парсит 1 страницу (20 вакансий) в видимом браузере.
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

async function scrapeVacancies(
  options: HhSearchOptions,
  headless: boolean,
  cookies: Cookie[],
): Promise<ScrapeResult> {
  const maxPages = options.maxPages ?? 1;
  const vacancies: ScrapedVacancyDetails[] = [];
  const errors: string[] = [];
  let pagesScraped = 0;

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
      // Отключаем webdriver detection
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
    const summaries = new Map<string, Awaited<ReturnType<typeof parseSearchPage>>[0]>();

    // Сбрасываем积累tracking при старте
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => false });
    });

    // Обход страниц поисковой выдачи
    for (let pageNum = 0; pageNum < maxPages; pageNum++) {
      const searchUrl = buildSearchUrl(options, pageNum);
      logger.info(`Загрузка страницы ${pageNum + 1}/${maxPages}`, { url: searchUrl });

      // Задержка перед каждым запросом — имитация пользователя
      await humanDelay();

      await page.goto(searchUrl, { waitUntil: "networkidle", timeout: 60_000 });

      // Имитация скролла страницы (сбрасывает "прочитанное")
      await page.evaluate(() => {
        window.scrollTo({ top: 0, behavior: "instant" });
      });
      await scrollDelay();
      await page.mouse.wheel(0, 300);
      await scrollDelay();
      await page.mouse.wheel(0, 500);
      await scrollDelay();

      // Ждём появления карточек вакансий
      try {
        await page.waitForSelector(
          '[data-qa="vacancy-serp__vacancy"], .vacancy-serp-item__layout, a[data-qa="serp-item__title"]',
          { timeout: 15_000 },
        );
      } catch {
        const content = await page.content();
        const hasContent = content.length > 5000;
        if (!hasContent) {
          errors.push(`Страница ${pageNum + 1} не загрузилась (пустой контент)`);
          continue;
        }
        // Если контент есть, но селекторы не нашлись — пробуем продолжить
        logger.warn(`Селекторы не найдены на странице ${pageNum + 1}, продолжаем...`);
      }

      pagesScraped++;
      const found = await parseSearchPage(page);
      logger.info(`Найдено вакансий на странице: ${found.length}`);

      for (const s of found) {
        if (s.hhId) summaries.set(s.hhId, s);
      }

      // Если это последняя страница — выходим из цикла
      if (pageNum + 1 >= maxPages) break;

      // Проверяем наличие следующей страницы
      const nextUrl = await getNextPageUrl(page);
      if (!nextUrl) {
        logger.info("Достигнута последняя страница");
        break;
      }
    }

    // Парсинг каждой вакансии
    let processed = 0;
    for (const [hhId, summary] of summaries) {
      processed++;
      const vacancyUrl = summary.url;
      logger.info(`Парсинг вакансии ${processed}/${summaries.size}: ${hhId}`);

      // Задержка перед открытием вакансии — имитация чтения списка
      await humanDelay(800, 2000);

      try {
        await page.goto(vacancyUrl, { waitUntil: "networkidle", timeout: 30_000 });

        // Имитация чтения страницы вакансии
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
        } catch {
          errors.push(`Не удалось загрузить страницу вакансии ${hhId}`);
          // Добавляем хотя бы краткие данные
          vacancies.push({
            ...summary,
            description: null,
            hiringFormats: [],
            skills: [],
            experience: null,
            employment: null,
            schedule: null,
            employerLogoUrl: null,
          });
          continue;
        }

        const details = await parseVacancyPage(page, summary);
        vacancies.push(details);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`Ошибка парсинга вакансии ${hhId}: ${msg}`);
        logger.error(`Ошибка парсинга ${hhId}`, { error: msg });
        // Добавляем хотя бы краткие данные
        vacancies.push({
          ...summary,
          description: null,
          hiringFormats: [],
          skills: [],
          experience: null,
          employment: null,
          schedule: null,
          employerLogoUrl: null,
        });
      }
    }

    await context.close();
  } finally {
    await browser.close();
  }

  return { keyword: options.keyword, vacancies, pagesScraped, errors };
}

function printResults(result: ScrapeResult): void {
  console.log("\n" + "=".repeat(60));
  console.log("РЕЗУЛЬТАТЫ СКРАПИНГА");
  console.log("=".repeat(60));
  console.log(`Ключевое слово: ${result.keyword}`);
  console.log(`Страниц обработано: ${result.pagesScraped}`);
  console.log(`Вакансий собрано: ${result.vacancies.length}`);
  if (result.errors.length > 0) {
    console.log(`\nОшибки (${result.errors.length}):`);
    for (const err of result.errors) {
      console.log(`  - ${err}`);
    }
  }
  console.log("\n" + "-".repeat(60));

  // Печатаем первые 20 вакансий
  const toShow = result.vacancies.slice(0, 20);
  for (const [i, v] of toShow.entries()) {
    console.log(`\n${i + 1}. ${v.title}`);
    console.log(`   hhId: ${v.hhId}`);
    console.log(`   Компания: ${v.employerName ?? "—"}`);
    if (v.salary) {
      const { from, to, currency, gross } = v.salary;
      const parts: string[] = [];
      if (from) parts.push(`от ${from.toLocaleString("ru-RU")}`);
      if (to) parts.push(`до ${to.toLocaleString("ru-RU")}`);
      const grossText = gross ? " (до вычета налогов)" : "";
      console.log(`   Зарплата: ${parts.join(" – ")} ${currency}${grossText}`);
    } else {
      console.log(`   Зарплата: не указана`);
    }
    console.log(`   Город: ${v.area ?? "—"}`);
    console.log(`   Опыт: ${v.experience ?? "—"}`);
    console.log(`   Формат: ${v.schedule ?? "—"}`);
    if (v.skills.length > 0) {
      console.log(`   Навыки: ${v.skills.slice(0, 5).join(", ")}${v.skills.length > 5 ? "..." : ""}`);
    }
    console.log(`   Ссылка: ${v.url}`);
  }

  if (result.vacancies.length > 20) {
    console.log(`\n... и ещё ${result.vacancies.length - 20} вакансий`);
  }
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

  // 2) Запускаем скрапинг с теми же параметрами что и в Hatchet workflow
  const searchOptions: HhSearchOptions = {
    keyword: cli.keyword,
    area: cli.area,
    maxPages: cli.maxPages,
  };

  const result = await scrapeVacancies(searchOptions, cli.headless, cookies);

  // 3) Печатаем результаты
  printResults(result);

  // 4) Сохраняем в файл если указан
  if (cli.outputFile) {
    const fs = await import("fs/promises");
    await fs.writeFile(cli.outputFile, JSON.stringify(result, null, 2), "utf-8");
    logger.info(`Результат сохранён в ${cli.outputFile}`);
    console.log(`\n💾 Результат сохранён в: ${cli.outputFile}`);
  }

  console.log("\n✅ Скрапинг завершён!\n");
}

main().catch((err) => {
  console.error("\n❌ test-search провалился:", err);
  process.exit(1);
});
