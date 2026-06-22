import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Browser, BrowserContext, Cookie } from "playwright";
import { chromium } from "playwright";

const HH_BASE_URL = "https://hh.ru";
const HH_LOGIN_URL = `${HH_BASE_URL}/account/login`;

/**
 * Загружает сохранённые cookies из файла.
 * Возвращает null если файл отсутствует или невалиден.
 */
export function loadCookies(cookiesPath: string): Cookie[] | null {
  try {
    if (!existsSync(cookiesPath)) return null;
    const raw = readFileSync(cookiesPath, "utf-8");
    const cookies = JSON.parse(raw) as Cookie[];
    if (!Array.isArray(cookies) || cookies.length === 0) return null;
    return cookies;
  } catch {
    return null;
  }
}

/**
 * Сохраняет cookies в файл для повторного использования.
 */
export function saveCookies(cookiesPath: string, cookies: Cookie[]): void {
  mkdirSync(dirname(cookiesPath), { recursive: true });
  writeFileSync(cookiesPath, JSON.stringify(cookies, null, 2), "utf-8");
}

/**
 * Проверяет, авторизован ли контекст (наличие session cookie hh.ru).
 */
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

/**
 * Выполняет авторизацию на hh.ru через Playwright.
 *
 * Flow:
 * 1. Переход на /account/login
 * 2. Нажать «Войти» (submit-button) — открывает форму ввода телефона
 * 3. Ввести номер телефона
 * 4. Нажать «Войти с паролем» (expand-login-by-password)
 * 5. Ввести пароль
 * 6. Нажать «Войти» (submit-button)
 *
 * Сохраняет cookies после успешного входа.
 *
 * @throws Error если авторизация не удалась
 */
export async function loginToHh(
  credentials: LoginCredentials,
  cookiesPath: string,
  headless = true,
): Promise<Cookie[]> {
  let browser: Browser | null = null;

  try {
    browser = await chromium.launch({ headless });
    const context: BrowserContext = await browser.newContext({
      locale: "ru-RU",
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    });
    const page = await context.newPage();

    // 1. Переходим на страницу логина
    await page.goto(HH_LOGIN_URL, { waitUntil: "networkidle" });

    // 2. Нажимаем кнопку «Войти» чтобы открыть форму ввода
    await page.locator('button[data-qa="submit-button"]').click();

    // 3. Вводим номер телефона
    const phoneInput = page.locator(
      "input[magritte-phone-input-national-number-input]",
    );
    await phoneInput.waitFor({ state: "visible", timeout: 10_000 });
    await phoneInput.fill(credentials.phone);

    // 4. Нажимаем «Войти с паролем»
    await page.locator('button[data-qa="expand-login-by-password"]').click();

    // 5. Вводим пароль
    const passwordInput = page.locator(
      'input[data-qa="applicant-login-input-password"]',
    );
    await passwordInput.waitFor({ state: "visible", timeout: 10_000 });
    await passwordInput.fill(credentials.password);

    // 6. Нажимаем «Войти» — отправка формы
    await page.locator('button[data-qa="submit-button"]').click();

    // Ждём навигации после успешного логина
    await page.waitForURL((url: URL) => !url.href.includes("/account/login"), {
      timeout: 15_000,
    });

    const cookies = await context.cookies();
    if (!isAuthenticated(cookies)) {
      throw new Error("Авторизация не удалась: сессионные cookies не найдены");
    }

    saveCookies(cookiesPath, cookies);
    return cookies;
  } finally {
    await browser?.close();
  }
}

/**
 * Возвращает актуальные cookies:
 * — из файла, если сессия ещё активна;
 * — выполняет повторный логин, если credentials предоставлены;
 * — возвращает пустой массив для анонимного скрапинга.
 */
export async function resolveCookies(options: {
  cookiesPath: string;
  credentials?: LoginCredentials;
  headless?: boolean;
}): Promise<Cookie[]> {
  const cached = loadCookies(options.cookiesPath);
  if (cached && isAuthenticated(cached)) {
    return cached;
  }

  if (options.credentials) {
    return loginToHh(
      options.credentials,
      options.cookiesPath,
      options.headless ?? true,
    );
  }

  return [];
}
