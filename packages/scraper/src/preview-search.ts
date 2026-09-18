import { logger } from "@job-radar/config";
import type { Cookie } from "playwright";
import { chromium } from "playwright";
import { getScraperConfig } from "./config.js";
import { resolveCookies } from "./hh/auth.js";

/**
 * CLI-скрипт «предпросмотр скрапинга в браузере».
 *
 * Запускает видимый Chromium, открывает hh.ru, авторизуется при наличии
 * HH_PHONE/HH_PASSWORD (или использует сохранённые cookies), затем
 * прогоняет одну страницу выдачи (20 вакансий) по заданному ключевому
 * слову и печатает результат в консоль.
 *
 * Поведение по умолчанию идентично ручному запуску: всё видно, можно
 * пройти CAPTCHA / двухфакторку «руками». Чтобы принудительно
 * использовать cookies из файла и не входить заново — `bun preview-search`
 * (cookies читаются из `HH_COOKIES_PATH`).
 *
 * Параметры CLI:
 *   bun preview-search --keyword="Удалённый менеджер" --area=113
 *   bun preview-search --max-pages=2 --keyword="Frontend"
 */

interface CliArgs {
  keyword: string;
  area: number;
  maxPages: number;
  /** Только пройти авторизацию и сохранить cookies, без поиска */
  loginOnly: boolean;
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
    maxPages: Number(get("--max-pages", "5") ?? "5"),
    loginOnly: has("--login-only"),
  };
}

const HH_BASE = "https://hh.ru";

/** Запускает интерактивный предпросмотр поисковой выдачи hh.ru. */
async function main() {
  const config = getScraperConfig();
  const cli = parseArgs();

  logger.info("preview-search: запуск", {
    headless: false,
    cookiesPath: config.cookiesPath,
    keyword: cli.keyword,
    area: cli.area,
    maxPages: cli.maxPages,
  });

  // 1) Cookies: сначала пробуем кэш, потом — при наличии кредов — логин.
  //    и явно передаём headless: false — нам обязательно видеть окно.
  const credentials =
    process.env.HH_PHONE && process.env.HH_PASSWORD
      ? { phone: process.env.HH_PHONE, password: process.env.HH_PASSWORD }
      : undefined;

  const cookies = await resolveCookies({
    cookiesPath: config.cookiesPath,
    credentials,
    headless: false,
  }).catch((err) => {
    logger.error("Не удалось получить cookies", err);
    return [] as Cookie[];
  });

  // Если попросили только залогиниться — закрываем и выходим.
  if (cli.loginOnly) {
    logger.info("Только авторизация (--login-only), поиск не запускаем");
    return;
  }

  const browser = await chromium.launch({
    headless: false,
    chromiumSandbox: false,
  });
  try {
    const context = await browser.newContext({
      locale: "ru-RU",
      viewport: { width: 1366, height: 900 },
    });

    if (cookies.length > 0) {
      await context.addCookies(
        cookies.map((c) => ({
          ...c,
          // playwright требует sameSite/url, добиваем дефолтами
          sameSite: c.sameSite ?? "Lax",
        })),
      );
    }

    const params = new URLSearchParams({
      text: cli.keyword,
      area: String(cli.area),
      per_page: "20",
      page: "0",
    });
    const url = `${HH_BASE}/search/vacancy?${params.toString()}`;

    logger.info("Открываю страницу поиска", { url });
    const page = await context.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });

    // Дать времени на возможный баннер/капчу — пользователь сам решит.
    console.log("\n=========================");
    console.log(" Браузер открыт. Действия руками:");
    console.log("   • Если есть CAPTCHA / 2FA / доп. форма — пройдите её.");
    console.log("   • Когда список вакансий прогрузится — нажмите ENTER.");
    console.log("=========================\n");
    await waitForEnter();

    // === Сбор карточек со страницы (первая страница выдачи) ===
    const cards = await page.$$eval(
      'div.vacancy-serp-item, [data-qa="vacancy-serp__vacancy"]',
      (nodes) =>
        nodes.map((n) => {
          const link = n.querySelector("a");
          const title = link?.textContent?.trim() ?? "";
          const href = (link as HTMLAnchorElement | null)?.href ?? "";
          const salary = n
            .querySelector('[data-qa="vacancy-serp__vacancy-compensation"]')
            ?.textContent?.trim();
          const company = n
            .querySelector('[data-qa="vacancy-serp__vacancy-employer"]')
            ?.textContent?.trim();
          return { title, href, salary, company };
        }),
    );

    logger.info(`Найдено карточек на 1-й странице: ${cards.length}`);

    console.log("\n--- Первые 20 вакансий с первой страницы выдачи ---");
    for (const [i, c] of cards.entries()) {
      console.log(
        `${String(i + 1).padStart(2, " ")}. ${c.title}\n     компания: ${c.company ?? "—"}\n     зп: ${c.salary ?? "—"}\n     ссылка: ${c.href}`,
      );
    }

    // === Проход по страницам (до maxPages) — собираем hhId + ссылку ===
    if (cli.maxPages > 1) {
      console.log(
        `\nДальше — обход ${cli.maxPages} страниц (можно остановить Ctrl+C в этом терминале).`,
      );
      const all: Array<{
        page: number;
        index: number;
        hhId: string | null;
        href: string;
        title: string;
      }> = [];

      // Уже собрали первую страницу, добавим в общий список.
      for (const [i, c] of cards.entries()) {
        const hhId = matchHhId(c.href);
        all.push({ page: 0, index: i, hhId, href: c.href, title: c.title });
      }

      for (let p = 1; p < cli.maxPages; p += 1) {
        const pageUrl = `${HH_BASE}/search/vacancy?${params.toString()}&page=${p}`;
        await page.goto(pageUrl, {
          waitUntil: "domcontentloaded",
          timeout: 60_000,
        });
        const more = await page.$$eval(
          '[data-qa="vacancy-serp__vacancy"]',
          (nodes) =>
            nodes.map((n) => {
              const link = n.querySelector("a");
              return {
                title: link?.textContent?.trim() ?? "",
                href: (link as HTMLAnchorElement | null)?.href ?? "",
              };
            }),
        );
        for (const [i, c] of more.entries()) {
          all.push({
            page: p,
            index: i,
            hhId: matchHhId(c.href),
            href: c.href,
            title: c.title,
          });
        }
        logger.info(`стр. ${p + 1}: ${more.length}`);
      }

      console.log(`\n--- Итого собрано: ${all.length} ссылок ---`);
      console.log("Первые 5:");
      for (const r of all.slice(0, 5)) {
        console.log(
          `  p${r.page + 1}#${r.index + 1} hhId=${r.hhId ?? "—"} ${r.title.slice(0, 80)}`,
        );
      }
    }

    console.log(
      "\nГотово. Браузер остаётся открытым, нажмите ENTER чтобы закрыть.",
    );
    await waitForEnter();
  } finally {
    await browser.close();
  }
}

function matchHhId(href: string): string | null {
  // URL вида https://hh.ru/vacancy/12345678?...
  const m = href.match(/\/vacancy\/(\d+)/);
  return m?.[1] ?? null;
}

async function waitForEnter(): Promise<void> {
  return new Promise((resolve) => {
    process.stdin.setEncoding("utf8");
    process.stdin.resume();
    process.stdin.once("data", () => resolve());
  });
}

main().catch((err) => {
  console.error("preview-search провалился:", err);
  process.exit(1);
});
