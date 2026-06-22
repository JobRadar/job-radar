import type { Page } from "playwright";
import type {
  HhSalary,
  ScrapedVacancyDetails,
  ScrapedVacancySummary,
} from "../types";

const HH_BASE_URL = "https://hh.ru";

/**
 * Парсит строку зарплаты hh.ru.
 * Примеры: "от 150 000 руб.", "100 000 – 200 000 ₽ до вычета налогов"
 */
export function parseSalary(text: string | null): HhSalary | null {
  if (!text) return null;

  const clean = text
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const currencyMap: Record<string, string> = {
    "руб.": "RUR",
    "₽": "RUR",
    $: "USD",
    "€": "EUR",
    usd: "USD",
    eur: "EUR",
    rur: "RUR",
  };

  let currency = "RUR";
  for (const [sym, code] of Object.entries(currencyMap)) {
    if (clean.toLowerCase().includes(sym.toLowerCase())) {
      currency = code;
      break;
    }
  }

  const gross = /до вычета/i.test(clean);

  const numbers =
    clean
      .match(/\d[\d\s]*/g)
      ?.map((n) => Number.parseInt(n.replace(/\s/g, ""), 10))
      .filter((n) => !Number.isNaN(n)) ?? [];

  const isTo = /^до/i.test(clean);

  if (numbers.length === 0) return null;
  if (numbers.length === 1) {
    return {
      from: isTo ? null : (numbers[0] ?? null),
      to: isTo ? (numbers[0] ?? null) : null,
      currency,
      gross,
    };
  }
  return { from: numbers[0] ?? null, to: numbers[1] ?? null, currency, gross };
}

/**
 * Извлекает ID вакансии из URL hh.ru.
 * https://hh.ru/vacancy/123456 → "123456"
 */
export function extractHhId(url: string): string | null {
  const match = url.match(/\/vacancy\/(\d+)/);
  return match?.[1] ?? null;
}

/**
 * Парсит дату публикации из строки hh.ru.
 * Форматы: "12 июня 2025", "вчера", "сегодня"
 */
export function parsePublishedAt(text: string | null): Date | null {
  if (!text) return null;

  const now = new Date();
  const clean = text.toLowerCase().trim();

  if (clean === "сегодня") return now;
  if (clean === "вчера") {
    const d = new Date(now);
    d.setDate(d.getDate() - 1);
    return d;
  }

  const monthMap: Record<string, number> = {
    января: 0,
    февраля: 1,
    марта: 2,
    апреля: 3,
    мая: 4,
    июня: 5,
    июля: 6,
    августа: 7,
    сентября: 8,
    октября: 9,
    ноября: 10,
    декабря: 11,
  };

  const m = clean.match(/(\d{1,2})\s+([а-я]+)(?:\s+(\d{4}))?/);
  if (m?.[1] && m[2]) {
    const day = Number.parseInt(m[1], 10);
    const month = monthMap[m[2]];
    const year = m[3] ? Number.parseInt(m[3], 10) : now.getFullYear();
    if (month !== undefined) {
      return new Date(year, month, day);
    }
  }

  return null;
}

/**
 * Парсит список карточек вакансий со страницы поисковой выдачи hh.ru.
 */
export async function parseSearchPage(
  page: Page,
): Promise<ScrapedVacancySummary[]> {
  return page
    .evaluate((baseUrl) => {
      const cards = document.querySelectorAll(
        '[data-qa="vacancy-serp__vacancy"], .vacancy-serp-item__layout',
      );

      return Array.from(cards).map((card) => {
        const titleEl = card.querySelector(
          '[data-qa="serp-item__title"], [data-qa="vacancy-serp__vacancy-title"]',
        );
        const employerEl = card.querySelector(
          '[data-qa="vacancy-serp__vacancy-employer-company-name"], [data-qa="employer-name"]',
        );
        const salaryEl = card.querySelector(
          '[data-qa="vacancy-serp__vacancy-compensation"]',
        );
        const areaEl = card.querySelector(
          '[data-qa="vacancy-serp__vacancy-address"], [data-qa="vacancy-serp__vacancy-address-text"]',
        );
        const dateEl = card.querySelector(
          '[data-qa="vacancy-serp__vacancy-date"]',
        );

        const href =
          titleEl?.closest("a")?.href ??
          card.querySelector("a[href*='/vacancy/']")?.getAttribute("href") ??
          "";

        const url = href.startsWith("http")
          ? (href.split("?")[0] ?? href)
          : `${baseUrl}${href.split("?")[0] ?? href}`;

        const hhIdMatch = url.match(/\/vacancy\/(\d+)/);

        return {
          hhId: hhIdMatch?.[1] ?? "",
          title: titleEl?.textContent?.trim() ?? "",
          employerName: employerEl?.textContent?.trim() ?? null,
          salaryText: salaryEl?.textContent?.trim() ?? null,
          area: areaEl?.textContent?.trim() ?? null,
          url,
          publishedAtText: dateEl?.textContent?.trim() ?? null,
        };
      });
    }, HH_BASE_URL)
    .then((items) =>
      items
        .filter((v) => v.hhId && v.title)
        .map((v) => ({
          hhId: v.hhId,
          title: v.title,
          employerName: v.employerName,
          salary: parseSalary(v.salaryText),
          area: v.area,
          url: v.url,
          publishedAt: parsePublishedAt(v.publishedAtText),
        })),
    );
}

/**
 * Парсит полную страницу вакансии hh.ru.
 */
export async function parseVacancyPage(
  page: Page,
  summary: ScrapedVacancySummary,
): Promise<ScrapedVacancyDetails> {
  const details = await page.evaluate(() => {
    const text = (sel: string) =>
      document.querySelector(sel)?.textContent?.trim() ?? null;

    const description =
      document.querySelector('[data-qa="vacancy-description"]')?.innerHTML ??
      null;

    const skills = Array.from(
      document.querySelectorAll(
        '[data-qa="skills-element"] span, [data-qa="bloko-tag__text"]',
      ),
    )
      .map((el) => el.textContent?.trim() ?? "")
      .filter(Boolean);

    const logoEl = document.querySelector(
      '[data-qa="vacancy-company-logo"] img',
    ) as HTMLImageElement | null;

    return {
      description,
      skills,
      experience:
        text('[data-qa="vacancy-experience"]') ??
        text('[data-qa="vacancy-view-employment-mode"]'),
      employment: text('[data-qa="vacancy-view-employment-mode"]'),
      schedule: text('[data-qa="vacancy-view-work-format"]'),
      employerLogoUrl: logoEl?.src ?? null,
    };
  });

  return { ...summary, ...details };
}

/**
 * Возвращает URL следующей страницы пагинации или null.
 */
export async function getNextPageUrl(page: Page): Promise<string | null> {
  const nextHref = await page.evaluate(() => {
    const btn = document.querySelector(
      '[data-qa="pager-next"], a[rel="next"]',
    ) as HTMLAnchorElement | null;
    return btn?.href ?? null;
  });

  return nextHref ?? null;
}
