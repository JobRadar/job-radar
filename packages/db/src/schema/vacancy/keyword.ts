import { sql } from "drizzle-orm";
import { pgTable } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod";
import { user } from "../auth/user";
import { Category } from "../category/category";

/**
 * Ключевые слова для поиска вакансий на hh.ru.
 * Каждая запись — отдельный поисковый запрос привязанный к пользователю.
 */
export const SearchKeyword = pgTable("search_keywords", (t) => ({
  id: t.uuid().notNull().primaryKey().defaultRandom(),
  userId: t
    .text()
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  /** Категория (роль), под которую ведётся поиск; наследуется вакансиями */
  categoryId: t.uuid().references(() => Category.id, { onDelete: "set null" }),
  keyword: t.varchar({ length: 256 }).notNull(),
  /** Код региона hh.ru: 1 — Москва, 2 — Санкт-Петербург, 0 — вся Россия */
  area: t.integer().default(113).notNull(), // 113 = вся Россия
  salaryFrom: t.integer(),
  salaryTo: t.integer(),
  /** Опыт работы: noExperience | between1And3 | between3And6 | moreThan6 */
  experience: t.varchar({ length: 32 }),
  /** Тип занятости: full | part | project | volunteer | probation */
  employment: t.varchar({ length: 32 }),
  isActive: t.boolean().default(true).notNull(),
  createdAt: t.timestamp().defaultNow().notNull(),
  updatedAt: t
    .timestamp({ mode: "date", withTimezone: true })
    .$onUpdateFn(() => sql`now()`),
}));

export const CreateSearchKeywordSchema = createInsertSchema(SearchKeyword, {
  keyword: z.string().min(1).max(256),
  area: z.number().int().default(113),
  salaryFrom: z.number().int().positive().optional(),
  salaryTo: z.number().int().positive().optional(),
  experience: z
    .enum(["noExperience", "between1And3", "between3And6", "moreThan6"])
    .optional(),
  employment: z
    .enum(["full", "part", "project", "volunteer", "probation"])
    .optional(),
}).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const SelectSearchKeywordSchema = createSelectSchema(SearchKeyword);

export type SearchKeywordRow = typeof SearchKeyword.$inferSelect;
export type NewSearchKeyword = typeof SearchKeyword.$inferInsert;
