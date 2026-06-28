import { loginToHh } from "./hh/auth.js";
import { getScraperConfig } from "./config.js";

// Загружаем окружение через config (использует @t3-oss/env-core)
import { LOG_FILE_PATH, logger } from "@job-radar/config";

const args = process.argv.slice(2);

async function main() {
  logger.info("Запущен CLI-скрипт авторизации", { logFilePath: LOG_FILE_PATH });
  
  const config = getScraperConfig();
  
  // Определяем режим headless:
  // По умолчанию берём из конфига
  // Если есть --headless или -h → true
  // Если есть --no-headless или --show-browser → false
  let headless = config.headless;
  if (args.includes("--headless") || args.includes("-h")) {
    headless = true;
  }
  if (args.includes("--no-headless") || args.includes("--show-browser")) {
    headless = false;
  }

  if (!process.env.HH_PHONE || !process.env.HH_PASSWORD) {
    logger.error("Отсутствуют переменные окружения HH_PHONE или HH_PASSWORD");
    console.error(
      "Ошибка: Нужно указать HH_PHONE и HH_PASSWORD в переменных окружения!",
    );
    process.exit(1);
  }

  console.log("Начинаем авторизацию на hh.ru...");
  console.log(`Headless: ${headless}`);
  console.log(`Cookies будут сохранены в: ${config.cookiesPath}`);
  console.log(`📝 Логи записываются в: ${LOG_FILE_PATH}`);
  if (!headless) {
    console.log("💡 Браузер откроется для авторизации!");
  }

  try {
    const cookies = await loginToHh(
      {
        phone: process.env.HH_PHONE,
        password: process.env.HH_PASSWORD,
      },
      config.cookiesPath,
      headless,
    );

    console.log("✅ Авторизация успешна! Cookies сохранены.");
    console.log(`Найдено ${cookies.length} cookies.`);
  } catch (error) {
    console.error("❌ Ошибка авторизации:", error);
    process.exit(1);
  }
}

main();
