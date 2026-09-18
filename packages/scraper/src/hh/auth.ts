import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { logger } from "@job-radar/config";
import type { Browser, BrowserContext, Cookie } from "playwright";
import { chromium } from "playwright";

const HH_LOGIN_URL = "https://hh.ru/account/login";

export function loadCookies(cookiesPath: string): Cookie[] | null {
  try {
    if (!existsSync(cookiesPath)) return null;
    const cookies = JSON.parse(readFileSync(cookiesPath, "utf-8")) as Cookie[];
    if (!Array.isArray(cookies) || cookies.length === 0) {
      logger.warn("Некорректный формат cookies", { cookiesPath });
      return null;
    }
    if (isAuthenticated(cookies)) return cookies;
    logger.info("Сессия истекла, требуется повторная авторизация", {
      cookiesPath,
    });
    return null;
  } catch (error) {
    logger.error("Ошибка при загрузке cookies", error, { cookiesPath });
    return null;
  }
}

export function saveCookies(cookiesPath: string, cookies: Cookie[]): void {
  mkdirSync(dirname(cookiesPath), { recursive: true });
  writeFileSync(cookiesPath, JSON.stringify(cookies, null, 2), "utf-8");
  logger.info("Cookies успешно сохранены", { count: cookies.length });
}

export function isAuthenticated(cookies: Cookie[]): boolean {
  return cookies.some(
    (c) =>
      c.name === "hhtoken" ||
      c.name === "hhuid" ||
      (c.domain.includes("hh.ru") && c.name.startsWith("_hh_")),
  );
}

export interface LoginCredentials {
  phone: string;
  password: string;
}

export async function loginToHh(
  credentials: LoginCredentials,
  cookiesPath: string,
  headless = false,
): Promise<Cookie[]> {
  let browser: Browser | null = null;
  let context: BrowserContext | null = null;

  logger.info("Авторизация на hh.ru", { headless });

  try {
    browser = await chromium.launch({ headless, chromiumSandbox: false });
    context = await browser.newContext({
      locale: "ru-RU",
      viewport: { width: 1280, height: 800 },
    });

    const page = context.pages()[0] ?? (await context.newPage());

    await page.goto(HH_LOGIN_URL, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await page.locator('button[data-qa="submit-button"]').click();

    await page
      .locator('input[data-qa="magritte-phone-input-national-number-input"]')
      .waitFor({ state: "visible", timeout: 10_000 });
    await page
      .locator('input[data-qa="magritte-phone-input-national-number-input"]')
      .fill(credentials.phone);

    await page.locator('button[data-qa="expand-login-by-password"]').click();

    await page
      .locator('input[data-qa="applicant-login-input-password"]')
      .waitFor({ state: "visible", timeout: 10_000 });
    await page
      .locator('input[data-qa="applicant-login-input-password"]')
      .fill(credentials.password);

    await page.locator('button[data-qa="submit-button"]').click();
    await page.waitForURL((url: URL) => !url.href.includes("/account/login"), {
      timeout: 15_000,
    });

    const cookies = await context.cookies();
    if (!isAuthenticated(cookies)) {
      throw new Error("Авторизация не удалась: сессионные cookies не найдены");
    }

    saveCookies(cookiesPath, cookies);
    return cookies;
  } catch (error) {
    logger.error("Ошибка при авторизации", error);
    throw error;
  } finally {
    await context?.close();
    await browser?.close();
  }
}

export async function resolveCookies(options: {
  cookiesPath: string;
  credentials?: LoginCredentials;
  headless?: boolean;
}): Promise<Cookie[]> {
  const cached = loadCookies(options.cookiesPath);
  if (cached) return cached;

  if (options.credentials) {
    return loginToHh(
      options.credentials,
      options.cookiesPath,
      options.headless ?? true,
    );
  }

  return [];
}
