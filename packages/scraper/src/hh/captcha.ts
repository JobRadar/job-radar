import { logger } from "@job-radar/config";
import type { CheerioAPI } from "cheerio";
import {
  type Browser,
  type BrowserContext,
  type Cookie,
  chromium,
  type Page,
} from "playwright";
import type { ScraperConfig } from "../config";

/**
 * Скрапинг остановлен из-за антибот-капчи hh.ru
 * ("Подтвердите, что вы не робот"). Требует ручного вмешательства —
 * решить капчу в видимом браузере (HH_SCRAPER_HEADLESS=false) и
 * перезапустить скрапинг.
 */
export class CaptchaDetectedError extends Error {
  constructor(public readonly url: string) {
    super(
      `hh.ru показал капчу на ${url} — скрапинг остановлен, нужно решить капчу вручную`,
    );
    this.name = "CaptchaDetectedError";
  }
}

// Именно "не робот", а не просто "робот" — иначе вакансии вроде
// "Педагог по робототехнике" принимаются за капчу.
const CAPTCHA_TITLE_RE = /не\s+робот|captcha/i;
const CAPTCHA_TEXT_RE = /подтвердите.{0,20}робот|текст с картинки/i;

/** Как часто проверять, не решили ли капчу вручную в открытом окне */
const CAPTCHA_POLL_MS = 5_000;

const NAVIGATION = { waitUntil: "domcontentloaded", timeout: 60_000 } as const;

/**
 * Определяет, что вместо ожидаемой страницы (выдача/вакансия) hh.ru
 * показал антибот-капчу. Проверяем по тексту, а не по CSS-селекторам —
 * вёрстка капчи может меняться, а формулировка "не робот" стабильна.
 */
export async function isCaptchaPage(page: Page): Promise<boolean> {
  const title = await page.title().catch(() => "");
  if (CAPTCHA_TITLE_RE.test(title)) return true;

  const bodyText = await page
    .evaluate(() => document.body.innerText)
    .catch(() => "");
  return CAPTCHA_TEXT_RE.test(bodyText);
}

/**
 * То же, что isCaptchaPage, но по HTML, загруженному без браузера.
 */
export function isCaptchaHtml($: CheerioAPI): boolean {
  if (CAPTCHA_TITLE_RE.test($("title").text())) return true;

  // В <script> лежат словари переводов hh.ru, в т.ч. строка «подтвердите,
  // что вы не робот» — ищем только по видимому тексту, как innerText.
  const body = $("body").clone();
  body.find("script, style, noscript, template").remove();
  return CAPTCHA_TEXT_RE.test(body.text());
}

/**
 * Ждёт, пока капча пропадёт со страницы (её решили в окне браузера).
 * Возвращает false, если за timeoutMs этого не случилось.
 */
async function waitForCaptchaGone(
  page: Page,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await page.waitForTimeout(Math.min(CAPTCHA_POLL_MS, deadline - Date.now()));
    if (!(await isCaptchaPage(page))) return true;
  }
  return false;
}

export interface CaptchaResolution {
  /** HTML целевой страницы, открытой уже без капчи */
  html: string;
  /** Cookies браузера после капчи — с ними hh.ru снова пускает HTTP-запросы */
  cookies: Cookie[];
}

/**
 * Скрапинг идёт HTTP-запросами без браузера, но капчу так не пройти.
 * Когда hh.ru показал капчу, страница открывается в браузере: там капчу
 * решает человек (HH_SCRAPER_HEADLESS=false) или просто истекает временная
 * блокировка. Браузер запускается только при первой капче и
 * переиспользуется до close().
 */
export class BrowserCaptchaResolver {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly config: ScraperConfig,
    private readonly initialCookies: Cookie[],
  ) {}

  /**
   * Открывает url в браузере и ждёт, пока капча не пропадёт — до
   * captchaMaxAttempts раз по captchaWaitMs. null — капча так и не прошла.
   * Параллельные вызовы выполняются по очереди: пока первый ждёт капчу,
   * остальные стоят, а потом обычно сразу получают страницу без неё.
   */
  resolve(url: string): Promise<CaptchaResolution | null> {
    const result = this.queue.then(() => this.resolveNow(url));
    this.queue = result.catch(() => undefined);
    return result;
  }

  async close(): Promise<void> {
    await this.browser?.close();
    this.browser = null;
    this.context = null;
  }

  private async getContext(): Promise<BrowserContext> {
    if (!this.context) {
      this.browser = await chromium.launch({
        headless: this.config.headless,
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
      });
      this.context = await this.browser.newContext();
      if (this.initialCookies.length > 0) {
        await this.context.addCookies(this.initialCookies);
      }
    }
    return this.context;
  }

  private async resolveNow(url: string): Promise<CaptchaResolution | null> {
    const context = await this.getContext();
    const page = await context.newPage();
    try {
      await page.goto(url, NAVIGATION);

      let attempt = 0;
      while (await isCaptchaPage(page)) {
        attempt++;
        if (attempt > this.config.captchaMaxAttempts) return null;

        const waitSec = Math.round(this.config.captchaWaitMs / 1000);
        logger.warn(
          this.config.headless
            ? `hh.ru показал капчу, жду ${waitSec}с и пробую снова (${attempt}/${this.config.captchaMaxAttempts})`
            : `hh.ru показал капчу — решите её в окне браузера, жду до ${waitSec}с (${attempt}/${this.config.captchaMaxAttempts})`,
          { url },
        );

        // После ручного решения hh.ru может оставить на другой странице —
        // возвращаемся на нужную; иначе просто перезагружаем текущую.
        if (await waitForCaptchaGone(page, this.config.captchaWaitMs)) {
          await page.goto(url, NAVIGATION);
        } else {
          await page.reload(NAVIGATION);
        }
      }

      return { html: await page.content(), cookies: await context.cookies() };
    } finally {
      await page.close().catch(() => undefined);
    }
  }
}
