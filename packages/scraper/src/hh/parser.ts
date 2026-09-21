import { logger } from "@job-radar/config";
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
 * Находит карточки вакансий на странице.
 *
 * Сначала пробуем стандартные селекторы (старый дизайн hh.ru).
 * Если карточек не нашлось — переходим к fallback: ищем все ссылки
 * с data-qa="serp-item__title" и поднимаемся до контейнера карточки.
 * Это нужно для нового дизайна Magritte, где карточка обёрнута в
 * произвольный div без стабильного data-qa на корневом элементе.
 */
function resolveCards(): Element[] {
  const standard = Array.from(
    document.querySelectorAll(
      '[data-qa="vacancy-serp__vacancy"], .vacancy-serp-item__layout',
    ),
  );
  if (standard.length > 0) return standard;

  // Fallback: находим карточки по ссылкам на вакансии
  const titleLinks = Array.from(
    document.querySelectorAll<HTMLAnchorElement>(
      'a[data-qa="serp-item__title"]',
    ),
  );

  const seen = new Set<Element>();
  for (const link of titleLinks) {
    // Поднимаемся вверх, ища осмысленный контейнер карточки
    let el: Element | null = link.parentElement;
    for (let i = 0; i < 12; i++) {
      if (!el) break;
      const dqa = el.getAttribute("data-qa") ?? "";
      const tag = el.tagName.toLowerCase();
      if (
        dqa.includes("vacancy") ||
        dqa.includes("serp") ||
        tag === "li" ||
        tag === "article"
      ) {
        seen.add(el);
        break;
      }
      el = el.parentElement;
    }
    // Если контейнер не нашли — берём прямого родителя ссылки
    if (!seen.has(link.parentElement as Element) && link.parentElement) {
      seen.add(link.parentElement);
    }
  }

  return Array.from(seen);
}

/**
 * Парсит список карточек вакансий со страницы поисковой выдачи hh.ru.
 *
 * Поддерживает оба дизайна hh.ru:
 * - Старый (bloko): карточки с data-qa="vacancy-serp__vacancy"
 * - Новый (Magritte): карточки без стабильного корневого атрибута,
 *   заголовок через data-qa="serp-item__title" / "serp-item__title-text"
 */
export async function parseSearchPage(
  page: Page,
): Promise<ScrapedVacancySummary[]> {
  return page
    .evaluate(
      ({ baseUrl, resolveCardsFn }) => {
        // Восстанавливаем функцию в контексте страницы
        // biome-ignore lint/security/noGlobalEval: намеренно — сериализуем вспомогательную функцию для page.evaluate
        const getCards = eval(`(${resolveCardsFn})`) as () => Element[];
        const cards = getCards();

        return cards.map((card) => {
          // Ссылка на вакансию (новый дизайн: data-qa на самом <a>)
          const linkEl =
            (card.querySelector(
              'a[data-qa="serp-item__title"], a[data-qa="vacancy-serp__vacancy-title"]',
            ) as HTMLAnchorElement | null) ??
            (card.querySelector(
              "a[href*='/vacancy/']",
            ) as HTMLAnchorElement | null);

          const href = linkEl?.href ?? "";
          const url = href.startsWith("http")
            ? (href.split("?")[0] ?? href)
            : `${baseUrl}${href.split("?")[0] ?? href}`;

          const hhIdMatch = url.match(/\/vacancy\/(\d+)/);

          // Текст заголовка: новый дизайн кладёт его во вложенный span
          const titleTextEl = card.querySelector(
            '[data-qa="serp-item__title-text"]',
          );
          const titleFallbackEl = card.querySelector(
            '[data-qa="serp-item__title"], [data-qa="vacancy-serp__vacancy-title"]',
          );
          const title =
            titleTextEl?.textContent?.trim() ??
            titleFallbackEl?.textContent?.trim() ??
            linkEl?.textContent?.trim() ??
            "";

          const employerEl = card.querySelector(
            '[data-qa="vacancy-serp__vacancy-employer-text"], [data-qa="vacancy-serp__vacancy-employer-company-name"], [data-qa="employer-name"]',
          );
          // В текущей вёрстке (Magritte) у блока зарплаты нет своего data-qa —
          // это первый прямой <span> внутри контейнера с классом
          // "compensation-labels" (остальные прямые дети — теги в <div>).
          const salaryEl = card.querySelector(
            '[data-qa="vacancy-serp__vacancy-compensation"], [class*="compensation-labels"] > span',
          );
          const areaEl = card.querySelector(
            '[data-qa="vacancy-serp__vacancy-address"], [data-qa="vacancy-serp__vacancy-address-text"]',
          );
          // Дата публикации по карточке выдачи в текущей вёрстке hh.ru
          // (Magritte) не имеет стабильного маркера — оставляем селектор
          // старого дизайна как fallback, но по факту почти всегда null.
          const dateEl = card.querySelector(
            '[data-qa="vacancy-serp__vacancy-date"]',
          );

          return {
            hhId: hhIdMatch?.[1] ?? "",
            title,
            employerName: employerEl?.textContent?.trim() ?? null,
            salaryText: salaryEl?.textContent?.trim() ?? null,
            area: areaEl?.textContent?.trim() ?? null,
            url,
            publishedAtText: dateEl?.textContent?.trim() ?? null,
          };
        });
      },
      { baseUrl: HH_BASE_URL, resolveCardsFn: resolveCards.toString() },
    )
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
 * Конвертирует DOM-элемент в читаемый plain text.
 *
 * Правила:
 * - Блочные элементы (p, div, h1-h6, li и т.д.) разделяются переносами строк
 * - <br> → перенос строки
 * - <li> получает маркер «• »
 * - Заголовки окружаются пустыми строками
 * - Множественные пустые строки сворачиваются в одну
 * - Горизонтальные пробелы нормализуются
 */
export function htmlToText(root: Element): string {
  const BLOCK = new Set([
    "P",
    "DIV",
    "SECTION",
    "ARTICLE",
    "BLOCKQUOTE",
    "PRE",
    "TABLE",
    "THEAD",
    "TBODY",
    "TFOOT",
    "TR",
    "TD",
    "TH",
    "FIGURE",
    "FIGCAPTION",
  ]);

  function walk(node: Node): string {
    if (node.nodeType === Node.TEXT_NODE) {
      return (node.textContent ?? "").replace(/[\r\n\t]+/g, " ");
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return "";

    const el = node as Element;
    const tag = el.tagName.toUpperCase();

    if (tag === "BR") return "\n";
    if (tag === "HR") return "\n\n---\n\n";

    const style = (el as HTMLElement).style;
    if (style?.display === "none" || style?.visibility === "hidden") return "";

    const inner = Array.from(el.childNodes).map(walk).join("");

    if (tag === "LI") {
      return `\n• ${inner.trim()}`;
    }
    if (tag === "UL" || tag === "OL") {
      return `\n${inner}\n`;
    }
    if (/^H[1-6]$/.test(tag)) {
      return `\n\n${inner.trim()}\n\n`;
    }
    if (BLOCK.has(tag)) {
      const trimmed = inner.trim();
      return trimmed ? `\n${trimmed}\n` : "";
    }

    return inner;
  }

  return walk(root)
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Парсит полную страницу вакансии hh.ru.
 */
export async function parseVacancyPage(
  page: Page,
  summary: ScrapedVacancySummary,
): Promise<ScrapedVacancyDetails> {
  let details:
    | (Omit<ScrapedVacancyDetails, keyof ScrapedVacancySummary> & {
        publishedAt: Date | null;
      })
    | null = null;
  try {
    logger.info("parseVacancyPage: выполняем evaluate на странице вакансии", {
      url: page.url(),
      hhId: summary.hhId,
    });

    type EvalResult = {
      description: string | null;
      descTextLen: number;
      descHTMLpreview: string;
      hiringFormats: string[];
      skills: string[];
      experience: string | null;
      employment: string | null;
      scheduleRaw: string | null;
      employerLogoUrl: string | null;
      employerUrl: string | null;
      datePostedRaw: string | null;
    };

    const evalResult: EvalResult = await page.evaluate(() => {
      const descEl = document.querySelector('[data-qa="vacancy-description"]');
      const descTextLen = descEl?.textContent?.trim().length ?? 0;
      const descHTMLpreview = descEl?.innerHTML.slice(0, 300) ?? "NOT FOUND";
      const description = descEl?.textContent?.trim() ?? null;

      const hiringFormatsEl = document.querySelector(
        'div[data-qa="vacancy-hiring-formats"]',
      );
      const hiringFormats = hiringFormatsEl
        ? Array.from(
            hiringFormatsEl.querySelectorAll(
              '[data-qa="vacancy-hiring-format"], [data-qa="hiring-format-tag"], span, li',
            ),
          )
            .map((el) => el.textContent?.trim() ?? "")
            .filter((v, i, arr) => v.length > 0 && arr.indexOf(v) === i)
        : [];

      // Каждый навык — отдельный элемент [data-qa="skills-element"] (Magritte,
      // текст лежит во вложенном div без стабильного data-qa — берём весь
      // textContent элемента). bloko-tag__text — fallback для старой вёрстки.
      const skills = Array.from(
        document.querySelectorAll(
          '[data-qa="skills-element"], [data-qa="bloko-tag__text"]',
        ),
      )
        .map((el) => el.textContent?.trim() ?? "")
        .filter(Boolean);

      const logoEl = document.querySelector(
        '[data-qa="vacancy-company-logo"] img',
      ) as HTMLImageElement | null;

      const companyLinkEl = document.querySelector(
        'a[data-qa="vacancy-company-name"]',
      ) as HTMLAnchorElement | null;

      const workFormatsEl = document.querySelector(
        '[data-qa="work-formats-text"], [data-qa="vacancy-view-work-format"]',
      );
      const scheduleRaw = workFormatsEl?.textContent?.trim() ?? null;

      // Дата публикации на карточке выдачи ничем не помечена (см.
      // buildSearchUrl), но hh.ru кладёт её в JSON-LD (schema.org/JobPosting)
      // на самой странице вакансии — это стабильный источник даты.
      let datePostedRaw: string | null = null;
      try {
        const ldScript = document.querySelector(
          'script[type="application/ld+json"]',
        );
        if (ldScript?.textContent) {
          const data = JSON.parse(ldScript.textContent);
          datePostedRaw =
            typeof data?.datePosted === "string" ? data.datePosted : null;
        }
      } catch {
        datePostedRaw = null;
      }

      return {
        description,
        descTextLen,
        descHTMLpreview,
        hiringFormats,
        skills,
        experience:
          document
            .querySelector('[data-qa="vacancy-experience"]')
            ?.textContent?.trim() ?? null,
        employment:
          document
            .querySelector('[data-qa="common-employment-text"]')
            ?.textContent?.trim() ?? null,
        scheduleRaw,
        employerLogoUrl: logoEl?.src ?? null,
        employerUrl: companyLinkEl?.href ?? null,
        datePostedRaw,
      };
    });

    logger.info("parseVacancyPage: результат evaluate", {
      descTextLen: evalResult.descTextLen,
      descPreview: evalResult.descHTMLpreview,
      descriptionLen: evalResult.description?.length ?? 0,
    });

    const scheduleClean = evalResult.scheduleRaw
      ? evalResult.scheduleRaw.replace(/^формат\s+работы\s*:\s*/i, "").trim() ||
        null
      : null;

    const parsedDate = evalResult.datePostedRaw
      ? new Date(evalResult.datePostedRaw)
      : null;
    const publishedAt =
      parsedDate && !Number.isNaN(parsedDate.getTime()) ? parsedDate : null;

    details = {
      description: evalResult.description,
      hiringFormats: evalResult.hiringFormats,
      skills: evalResult.skills,
      experience: evalResult.experience,
      employment: evalResult.employment,
      schedule: scheduleClean,
      employerLogoUrl: evalResult.employerLogoUrl,
      employerUrl: evalResult.employerUrl,
      publishedAt,
    };
  } catch (err) {
    logger.error("parseVacancyPage: evaluate выбросил ошибку", err);
    details = null;
  }

  if (details === null) {
    return {
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
  }

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
