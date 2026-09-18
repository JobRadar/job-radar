import { pgTable } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod";

/**
 * Категория (роль), под которую ведётся поиск вакансий и генерация резюме.
 *
 * Примеры: ai-engineer, fullstack-engineer, bitrix-developer,
 * bitrix-administrator. Справочник наполняется seed-скриптом и может
 * расширяться вручную или через админку.
 *
 * Категория — связующее звено цикла «найти работу»:
 *   категория → вакансии (скрапинг) → анализ требований →
 *   генерация резюме → оценка соответствия.
 */
export const Category = pgTable("categories", (t) => ({
  id: t.uuid().notNull().primaryKey().defaultRandom(),
  /** Машинный идентификатор роли, напр. "ai-engineer" */
  slug: t.varchar({ length: 64 }).notNull().unique(),
  /** Человекочитаемое название, напр. "AI Engineer" */
  label: t.varchar({ length: 128 }).notNull(),
  /** Краткое описание роли */
  description: t.text(),
  createdAt: t.timestamp().defaultNow().notNull(),
}));

export const CreateCategorySchema = createInsertSchema(Category, {
  slug: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9-]+$/, "Только строчные латинские буквы, цифры и дефис"),
  label: z.string().min(1).max(128),
  description: z.string().max(2_000).optional(),
}).omit({
  id: true,
  createdAt: true,
});

export const SelectCategorySchema = createSelectSchema(Category);

export type CategoryRow = typeof Category.$inferSelect;
export type NewCategory = typeof Category.$inferInsert;
