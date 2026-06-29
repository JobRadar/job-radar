import { loginToHh } from "./hh/auth.js";
import { getScraperConfig } from "./config.js";
import { logger } from "@job-radar/config";

const args = process.argv.slice(2);

async function main() {
  logger.info("Запущен CLI-скрипт авторизации");

  const config = getScraperConfig();

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
