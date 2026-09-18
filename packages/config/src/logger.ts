type LogLevel = "debug" | "info" | "warn" | "error";

type LogMeta = Record<string, unknown>;

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

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

  const line = JSON.stringify(entry);

  // biome-ignore lint/suspicious/noConsole: the logger is the sanctioned console boundary
  if (level === "error") console.error(line);
  // biome-ignore lint/suspicious/noConsole: the logger is the sanctioned console boundary
  else if (level === "warn") console.warn(line);
  // biome-ignore lint/suspicious/noConsole: the logger is the sanctioned console boundary
  else console.log(line);
}

function setupGlobalErrorHandlers() {
  process.on("uncaughtException", (error) => {
    logger.error("Необработанное исключение", error, {
      type: "uncaughtException",
    });
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
