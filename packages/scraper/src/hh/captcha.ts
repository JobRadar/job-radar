import type { Page } from "playwright";

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

/**
 * Определяет, что вместо ожидаемой страницы (выдача/вакансия) hh.ru
 * показал антибот-капчу. Проверяем по тексту, а не по CSS-селекторам —
 * вёрстка капчи может меняться, а формулировка "не робот" стабильна.
 */
export async function isCaptchaPage(page: Page): Promise<boolean> {
  const title = await page.title().catch(() => "");
  if (/робот|captcha/i.test(title)) return true;

  const bodyText = await page
    .evaluate(() => document.body.innerText)
    .catch(() => "");
  return /подтвердите.{0,20}робот|текст с картинки/i.test(bodyText);
}
