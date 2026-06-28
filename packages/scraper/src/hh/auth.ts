import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { logger } from "@job-radar/config";
import type { Browser, BrowserContext, Cookie } from "playwright";
import { chromium } from "playwright";

const HH_BASE_URL = "https://hh.ru";
const HH_LOGIN_URL = `${HH_BASE_URL}/account/login`;

/**
 * Загружает сохранённые cookies из файла.
 * Возвращает null если файл отсутствует или невалиден.
 */
export function loadCookies(cookiesPath: string): Cookie[] | null {
  logger.debug("Загружаем cookies из файла", { cookiesPath });
  try {
    if (!existsSync(cookiesPath)) {
      logger.debug("Файл с cookies не найден", { cookiesPath });
      return null;
    }
    const raw = readFileSync(cookiesPath, "utf-8");
    const cookies = JSON.parse(raw) as Cookie[];
    if (!Array.isArray(cookies) || cookies.length === 0) {
      logger.warn("Некорректный формат cookies", {
        cookiesPath,
        cookiesType: typeof cookies,
        cookiesLength: cookies.length,
      });
      return null;
    }
    logger.debug("Cookies успешно загружены", {
      cookiesPath,
      count: cookies.length,
    });
    return cookies;
  } catch (error) {
    logger.error("Ошибка при загрузке cookies", error, { cookiesPath });
    return null;
  }
}

/**
 * Сохраняет cookies в файл для повторного использования.
 */
export function saveCookies(cookiesPath: string, cookies: Cookie[]): void {
  logger.debug("Сохраняем cookies в файл", {
    cookiesPath,
    count: cookies.length,
  });
  try {
    mkdirSync(dirname(cookiesPath), { recursive: true });
    writeFileSync(cookiesPath, JSON.stringify(cookies, null, 2), "utf-8");
    logger.info("Cookies успешно сохранены", {
      cookiesPath,
      count: cookies.length,
    });
  } catch (error) {
    logger.error("Ошибка при сохранении cookies", error, { cookiesPath });
    throw error;
  }
}

/**
 * Проверяет, авторизован ли контекст (наличие session cookie hh.ru).
 */
export function isAuthenticated(cookies: Cookie[]): boolean {
  const result = cookies.some(
    (c) =>
      c.name === "hhtoken" ||
      c.name === "hhuid" ||
      (c.domain.includes("hh.ru") && c.name.startsWith("_hh_")),
  );
  logger.debug("Проверка авторизации по cookies", {
    isAuthenticated: result,
    cookiesCount: cookies.length,
  });
  return result;
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
  headless = false,
): Promise<Cookie[]> {
  let browser: Browser | null = null;

  logger.info("Начинаем авторизацию на hh.ru", {
    headless,
    cookiesPath,
    phoneLength: credentials.phone.length,
  });

  try {
    logger.debug("Запускаем браузер Chromium", {
      headless,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--start-maximized"],
      ignoreDefaultArgs: ["--no-startup-window"],
    });
    browser = await chromium.launch({
      headless,
      timeout: 300000, // 5 minutes launch timeout
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--start-maximized"],
      ignoreDefaultArgs: ["--no-startup-window"],
      handleSIGHUP: false,
      handleSIGINT: false,
      handleSIGTERM: false,
    });

    // Логируем stderr браузера
    browser.on("disconnected", () => logger.debug("Браузер отключился"));
    // @ts-expect-error - process() method exists in Playwright
    const process = browser.process() as any;
    if (process) {
      logger.debug("Процесс браузера запущен", { pid: process.pid });
      process.stderr?.on("data", (data: Buffer) => {
        logger.debug("Chromium stderr", { data: data.toString() });
      });
      process.stdout?.on("data", (data: Buffer) => {
        logger.debug("Chromium stdout", { data: data.toString() });
      });
    }
    logger.info("Браузер Chromium успешно запущен", {
      browserVersion: browser.version(),
    });

    logger.debug("Создаем контекст браузера", { locale: "ru-RU" });
    const context: BrowserContext = await browser.newContext({
      locale: "ru-RU",
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    });
    logger.debug("Контекст браузера создан");

    logger.debug("Создаем новую страницу");
    const page = await context.newPage();

    // Логируем все события страницы
    page.on("request", (request) => {
      logger.debug("Запрос", { url: request.url(), method: request.method() });
    });
    page.on("response", (response) => {
      logger.debug("Ответ", { url: response.url(), status: response.status() });
    });
    page.on("console", (msg) => {
      logger.debug("Консоль браузера", { type: msg.type(), text: msg.text() });
    });
    page.on("pageerror", (error) => {
      logger.error("Ошибка на странице", error);
    });

    logger.info("Новая страница создана");

    // 1. Переходим на страницу логина
    logger.debug("Переходим на страницу логина", { url: HH_LOGIN_URL });
    await page.goto(HH_LOGIN_URL, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    logger.info("Страница логина загружена", { url: page.url() });

    // 2. Нажимаем кнопку «Войти» чтобы открыть форму ввода
    logger.debug("Нажимаем кнопку «Войти»", {
      selector: 'button[data-qa="submit-button"]',
    });
    await page.locator('button[data-qa="submit-button"]').click();
    logger.debug("Кнопка «Войти» нажата");

    // 3. Вводим номер телефона
    logger.debug("Ожидаем поле ввода телефона");
    const phoneInput = page.locator(
      "input[magritte-phone-input-national-number-input]",
    );
    await phoneInput.waitFor({ state: "visible", timeout: 10_000 });
    logger.debug("Поле ввода телефона доступно, заполняем");
    await phoneInput.fill(credentials.phone);
    logger.info("Номер телефона введен");

    // 4. Нажимаем «Войти с паролем»
    logger.debug("Нажимаем кнопку «Войти с паролем»", {
      selector: 'button[data-qa="expand-login-by-password"]',
    });
    await page.locator('button[data-qa="expand-login-by-password"]').click();
    logger.debug("Кнопка «Войти с паролем» нажата");

    // 5. Вводим пароль
    logger.debug("Ожидаем поле ввода пароля");
    const passwordInput = page.locator(
      'input[data-qa="applicant-login-input-password"]',
    );
    await passwordInput.waitFor({ state: "visible", timeout: 10_000 });
    logger.debug("Поле ввода пароля доступно, заполняем");
    await passwordInput.fill(credentials.password);
    logger.info("Пароль введен");

    // 6. Нажимаем «Войти» — отправка формы
    logger.debug("Нажимаем кнопку отправки формы", {
      selector: 'button[data-qa="submit-button"]',
    });
    await page.locator('button[data-qa="submit-button"]').click();
    logger.debug("Форма отправлена, ожидаем навигации");

    // Ждём навигации после успешного логина
    await page.waitForURL((url: URL) => !url.href.includes("/account/login"), {
      timeout: 15_000,
    });
    logger.info("Навигация после авторизации выполнена", { url: page.url() });

    const cookies = await context.cookies();
    if (!isAuthenticated(cookies)) {
      logger.error("Авторизация не удалась: сессионные cookies не найдены");
      throw new Error("Авторизация не удалась: сессионные cookies не найдены");
    }

    saveCookies(cookiesPath, cookies);
    logger.info("Авторизация успешно выполнена");
    return cookies;
  } catch (error) {
    logger.error("Ошибка при авторизации", error);
    throw error;
  } finally {
    logger.debug("Закрываем браузер");
    await browser?.close();
    logger.info("Браузер закрыт");
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
