import { db } from "../client";
import { Category, type NewCategory } from "../schema/category/category";

/**
 * Seed справочника категорий (ролей).
 *
 * Идемпотентен: при повторном запуске существующие slug пропускаются.
 * Запуск (из packages/db):
 * ```bash
 * bun --env-file=../../.env run src/scripts/seed-categories.ts
 * ```
 */
const CATEGORIES: NewCategory[] = [
  {
    slug: "ai-engineer",
    label: "AI Engineer",
    description:
      "Разработка ИИ-решений: LLM-приложения, ML-пайплайны, интеграция моделей, RAG, инференс.",
  },
  {
    slug: "fullstack-engineer",
    label: "Fullstack Engineer",
    description:
      "Full-stack разработка веб-приложений: фронтенд и бэкенд, API, базы данных, инфраструктура.",
  },
  {
    slug: "bitrix-developer",
    label: "Bitrix Developer",
    description:
      "Разработка на 1С-Битрикс: модули, компоненты, интеграции, доработка сайтов и порталов.",
  },
  {
    slug: "bitrix-administrator",
    label: "Bitrix Administrator",
    description:
      "Администрирование 1С-Битрикс: настройка, поддержка, обновления, производительность, бэкапы.",
  },
];

async function seedCategories() {
  try {
    // biome-ignore lint/suspicious/noConsole: CLI script output
    console.log("🌱 Seeding categories...");

    const inserted = await db
      .insert(Category)
      .values(CATEGORIES)
      .onConflictDoNothing({ target: Category.slug })
      .returning({ slug: Category.slug });

    // biome-ignore lint/suspicious/noConsole: CLI script output
    console.log(
      `✅ Categories seeded. New: ${inserted.length} (${inserted
        .map((c) => c.slug)
        .join(", ")})`,
    );
  } catch (error) {
    // biome-ignore lint/suspicious/noConsole: CLI error output
    console.error("❌ Error seeding categories:", error);
    process.exit(1);
  } finally {
    process.exit(0);
  }
}

seedCategories();
