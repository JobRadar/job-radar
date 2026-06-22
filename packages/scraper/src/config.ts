export interface ScraperConfig {
  /** Директория хранилища crawlee (RequestQueue, KeyValueStore, Dataset) */
  storageDir: string;
  /** Путь к файлу с сохранёнными cookies hh.ru */
  cookiesPath: string;
  /** Максимальное число параллельных браузерных страниц */
  maxConcurrency: number;
  /** Задержка между запросами [min, max] в мс — снижает шанс блокировки */
  requestDelay: [number, number];
  /** Число повторных попыток при ошибке на запрос */
  maxRetries: number;
  /** Показывать браузер (false = headless) */
  headless: boolean;
}

export function getScraperConfig(): ScraperConfig {
  return {
    storageDir: process.env.CRAWLEE_STORAGE_DIR ?? "./storage/crawlee",
    cookiesPath: process.env.HH_COOKIES_PATH ?? "./storage/hh-cookies.json",
    maxConcurrency: Number(process.env.HH_SCRAPER_CONCURRENCY ?? "2"),
    requestDelay: [1500, 3500],
    maxRetries: 3,
    headless: process.env.HH_SCRAPER_HEADLESS !== "false",
  };
}
