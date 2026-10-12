import { logger } from "@job-radar/config";
import {
  type AnyNode,
  type Cheerio,
  type CheerioAPI,
  type Element as CheerioElement,
  load,
} from "cheerio";
import type { Page } from "playwright";
import type {
  HhSalary,
  ScrapedVacancyDetails,
  ScrapedVacancySummary,
} from "../types";

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

/** Абсолютный URL по href из HTML (в разметке hh.ru бывают и относительные) */
function resolveUrl(href: string | undefined, pageUrl: string): string | null {
  if (!href) return null;
  try {
    return new URL(href, pageUrl).href;
  } catch {
    return null;
  }
}

/**
 * Текст первого элемента по селектору. null — если элемента нет вовсе
 * (пустой элемент даёт "", как textContent в браузере).
 */
function textOf<T extends AnyNode>(
  root: Cheerio<T>,
  selector: string,
): string | null {
  const el = root.find(selector).first();
  return el.length > 0 ? el.text().trim() : null;
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
function resolveCards($: CheerioAPI): Cheerio<CheerioElement> {
  const standard = $(
    '[data-qa="vacancy-serp__vacancy"], .vacancy-serp-item__layout',
  );
  if (standard.length > 0) return standard;

  // Fallback: находим карточки по ссылкам на вакансии
  const seen = new Set<CheerioElement>();
  for (const link of $('a[data-qa="serp-item__title"]').toArray()) {
    // Поднимаемся вверх, ища осмысленный контейнер карточки
    let el = $(link).parent();
    let container: CheerioElement | null = null;
    for (let i = 0; i < 12 && el.length > 0; i++) {
      const dqa = el.attr("data-qa") ?? "";
      const tag = el.get(0)?.tagName.toLowerCase() ?? "";
      if (
        dqa.includes("vacancy") ||
        dqa.includes("serp") ||
        tag === "li" ||
        tag === "article"
      ) {
        container = el.get(0) ?? null;
        break;
      }
      el = el.parent();
    }
    // Если контейнер не нашли — берём прямого родителя ссылки
    const card = container ?? $(link).parent().get(0);
    if (card) seen.add(card);
  }

  return $([...seen]);
}

/**
 * Парсит список карточек вакансий из HTML поисковой выдачи hh.ru.
 *
 * Поддерживает оба дизайна hh.ru:
 * - Старый (bloko): карточки с data-qa="vacancy-serp__vacancy"
 * - Новый (Magritte): карточки без стабильного корневого атрибута,
 *   заголовок через data-qa="serp-item__title" / "serp-item__title-text"
 */
export function parseSearchHtml(
  $: CheerioAPI,
  pageUrl: string,
): ScrapedVacancySummary[] {
  return resolveCards($)
    .toArray()
    .map((node) => {
      const card = $(node);

      // Ссылка на вакансию (новый дизайн: data-qa на самом <a>)
      let linkEl = card
        .find(
          'a[data-qa="serp-item__title"], a[data-qa="vacancy-serp__vacancy-title"]',
        )
        .first();
      if (linkEl.length === 0) {
        linkEl = card.find("a[href*='/vacancy/']").first();
      }

      // Query-параметры в ссылке — трекинг выдачи, в URL вакансии не нужны
      const url = resolveUrl(linkEl.attr("href"), pageUrl)?.split("?")[0] ?? "";
      const hhIdMatch = url.match(/\/vacancy\/(\d+)/);

      // Текст заголовка: новый дизайн кладёт его во вложенный span
      const title =
        textOf(card, '[data-qa="serp-item__title-text"]') ??
        textOf(
          card,
          '[data-qa="serp-item__title"], [data-qa="vacancy-serp__vacancy-title"]',
        ) ??
        (linkEl.length > 0 ? linkEl.text().trim() : "");

      const employerName = textOf(
        card,
        '[data-qa="vacancy-serp__vacancy-employer-text"], [data-qa="vacancy-serp__vacancy-employer-company-name"], [data-qa="employer-name"]',
      );
      // В текущей вёрстке (Magritte) у блока зарплаты нет своего data-qa —
      // это первый прямой <span> внутри контейнера с классом
      // "compensation-labels" (остальные прямые дети — теги в <div>).
      const salaryText = textOf(
        card,
        '[data-qa="vacancy-serp__vacancy-compensation"], [class*="compensation-labels"] > span',
      );
      const area = textOf(
        card,
        '[data-qa="vacancy-serp__vacancy-address"], [data-qa="vacancy-serp__vacancy-address-text"]',
      );
      // Дата публикации по карточке выдачи в текущей вёрстке hh.ru
      // (Magritte) не имеет стабильного маркера — оставляем селектор
      // старого дизайна как fallback, но по факту почти всегда null.
      const publishedAtText = textOf(
        card,
        '[data-qa="vacancy-serp__vacancy-date"]',
      );

      return {
        hhId: hhIdMatch?.[1] ?? "",
        title,
        employerName,
        salary: parseSalary(salaryText),
        area,
        url,
        publishedAt: parsePublishedAt(publishedAtText),
      };
    })
    .filter((v) => v.hhId && v.title);
}

/**
 * То же, что parseSearchHtml, но для открытой в Playwright страницы.
 */
export async function parseSearchPage(
  page: Page,
): Promise<ScrapedVacancySummary[]> {
  return parseSearchHtml(load(await page.content()), page.url());
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
 * Ссылка на логотип работодателя. <img> логотипа hh.ru заполняет уже на
 * клиенте, поэтому в HTML (без браузера) ссылки есть только в начальном
 * состоянии страницы — <template id="HH-Lux-InitialState">.
 */
function parseEmployerLogoUrl($: CheerioAPI, pageUrl: string): string | null {
  const img = $('[data-qa="vacancy-company-logo"] img[src]')
    .first()
    .attr("src");
  if (img) return resolveUrl(img, pageUrl);

  try {
    const state = JSON.parse($("template#HH-Lux-InitialState").text());
    const logos: { type?: string; url?: string }[] =
      state?.vacancyView?.vacancyFull?.vacancy?.company?.logos ?? [];
    const logo =
      logos.find((l) => l.type === "vacancyPage") ??
      logos.find((l) => l.type === "employerPage") ??
      logos[0];
    return resolveUrl(logo?.url, pageUrl);
  } catch {
    return null;
  }
}

/**
 * Парсит HTML страницы вакансии hh.ru.
 */
export function parseVacancyHtml(
  $: CheerioAPI,
  summary: ScrapedVacancySummary,
  pageUrl: string = summary.url,
): ScrapedVacancyDetails {
  const description = textOf($.root(), '[data-qa="vacancy-description"]');

  const hiringFormats = $('div[data-qa="vacancy-hiring-formats"]')
    .first()
    .find(
      '[data-qa="vacancy-hiring-format"], [data-qa="hiring-format-tag"], span, li',
    )
    .toArray()
    .map((el) => $(el).text().trim())
    .filter((v, i, arr) => v.length > 0 && arr.indexOf(v) === i);

  // Каждый навык — отдельный элемент [data-qa="skills-element"] (Magritte,
  // текст лежит во вложенном div без стабильного data-qa — берём весь
  // текст элемента). bloko-tag__text — fallback для старой вёрстки.
  const skills = $('[data-qa="skills-element"], [data-qa="bloko-tag__text"]')
    .toArray()
    .map((el) => $(el).text().trim())
    .filter(Boolean);

  const scheduleRaw = textOf(
    $.root(),
    '[data-qa="work-formats-text"], [data-qa="vacancy-view-work-format"]',
  );
  const schedule = scheduleRaw
    ? scheduleRaw.replace(/^формат\s+работы\s*:\s*/i, "").trim() || null
    : null;

  // Дата публикации на карточке выдачи ничем не помечена (см.
  // parseSearchHtml), но hh.ru кладёт её в JSON-LD (schema.org/JobPosting)
  // на самой странице вакансии — это стабильный источник даты.
  let publishedAt: Date | null = null;
  try {
    const data = JSON.parse(
      $('script[type="application/ld+json"]').first().text(),
    );
    const parsed =
      typeof data?.datePosted === "string" ? new Date(data.datePosted) : null;
    publishedAt = parsed && !Number.isNaN(parsed.getTime()) ? parsed : null;
  } catch {
    publishedAt = null;
  }

  logger.info("parseVacancyHtml: вакансия разобрана", {
    hhId: summary.hhId,
    descriptionLen: description?.length ?? 0,
    skills: skills.length,
  });

  return {
    ...summary,
    description,
    hiringFormats,
    skills,
    experience: textOf($.root(), '[data-qa="vacancy-experience"]'),
    employment: textOf($.root(), '[data-qa="common-employment-text"]'),
    schedule,
    employerLogoUrl: parseEmployerLogoUrl($, pageUrl),
    employerUrl: resolveUrl(
      $('a[data-qa="vacancy-company-name"]').first().attr("href"),
      pageUrl,
    ),
    publishedAt,
  };
}

/**
 * То же, что parseVacancyHtml, но для открытой в Playwright страницы.
 */
export async function parseVacancyPage(
  page: Page,
  summary: ScrapedVacancySummary,
): Promise<ScrapedVacancyDetails> {
  return parseVacancyHtml(load(await page.content()), summary, page.url());
}

/**
 * Возвращает URL следующей страницы пагинации или null.
 */
export function parseNextPageUrl(
  $: CheerioAPI,
  pageUrl: string,
): string | null {
  return resolveUrl(
    $('[data-qa="pager-next"], a[rel="next"]').first().attr("href"),
    pageUrl,
  );
}
