import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Minimal dependency-free structured logger.
 *
 * Emits one JSON line per entry so logs are machine-parseable in any
 * environment (Vercel, Docker, etc.) and play nicely with log drains and
 * OpenTelemetry collectors. This is the single sanctioned place in the
 * codebase that is allowed to call `console.*`.
 */

type LogLevel = "debug" | "info" | "warn" | "error";

type LogMeta = Record<string, unknown>;

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

// Путь к файлу логов (в корне проекта, storage/logs)
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, "../../..");
const LOG_FILE_PATH = join(rootDir, "storage", "logs", "scraper.log");

// Убеждаемся, что директория для логов существует
function ensureLogDir() {
  const logDir = dirname(LOG_FILE_PATH);
  if (!existsSync(logDir)) {
    mkdirSync(logDir, { recursive: true });
  }
}

function resolveMinLevel(): LogLevel {
  const fromEnv = process.env.LOG_LEVEL?.toLowerCase();
  if (fromEnv && fromEnv in LEVEL_PRIORITY) {
    return fromEnv as LogLevel;
  }
  return process.env.NODE_ENV === "production" ? "info" : "debug";
}

const minLevel = resolveMinLevel();

function serializeError(error: unknown): LogMeta {
  if (error instanceof Error) {
    return { name: error.name, message: error.message, stack: error.stack };
  }
  return { error: String(error) };
}

function write(level: LogLevel, message: string, meta?: LogMeta): void {
  if (LEVEL_PRIORITY[level] < LEVEL_PRIORITY[minLevel]) {
    return;
  }

  const entry = {
    level,
    time: new Date().toISOString(),
    msg: message,
    ...meta,
  };

  const line = JSON.stringify(entry) + "\n";

  // biome-ignore lint/suspicious/noConsole: the logger is the sanctioned console boundary
  if (level === "error") console.error(line.trim());
  // biome-ignore lint/suspicious/noConsole: the logger is the sanctioned console boundary
  else if (level === "warn") console.warn(line.trim());
  // biome-ignore lint/suspicious/noConsole: the logger is the sanctioned console boundary
  else console.log(line.trim());

  // Записываем в файл
  try {
    ensureLogDir();
    appendFileSync(LOG_FILE_PATH, line, "utf-8");
  } catch (fileError) {
    console.error("Не удалось записать лог в файл:", fileError);
  }
}

// Перехват необработанных исключений и unhandled rejections
function setupGlobalErrorHandlers() {
  process.on("uncaughtException", (error) => {
    logger.error("Необработанное исключение", error, { type: "uncaughtException" });
    process.exit(1);
  });

  process.on("unhandledRejection", (reason, promise) => {
    logger.error("Необработанная ошибка промиса", reason, {
      type: "unhandledRejection",
      promise: String(promise),
    });
  });
}

setupGlobalErrorHandlers();

export const logger = {
  debug: (message: string, meta?: LogMeta) => write("debug", message, meta),
  info: (message: string, meta?: LogMeta) => write("info", message, meta),
  warn: (message: string, meta?: LogMeta) => write("warn", message, meta),
  error: (message: string, error?: unknown, meta?: LogMeta) =>
    write("error", message, {
      ...(error === undefined ? {} : serializeError(error)),
      ...meta,
    }),
};

export type Logger = typeof logger;
export { LOG_FILE_PATH };
