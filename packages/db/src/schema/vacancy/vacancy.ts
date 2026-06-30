import { pgTable } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { Category } from "../category/category";
import { SearchKeyword } from "./keyword";

/**
 * Структура данных о зарплате из hh.ru.
 */
export interface HhSalary {
  from: number | null;
  to: number | null;
  currency: string;
  gross: boolean;
}

/**
 * Найденные вакансии с hh.ru.
 * hhId уникален — при повторном скрапинге одна и та же вакансия не дублируется.
 */
export const Vacancy = pgTable("vacancies", (t) => ({
  id: t.uuid().notNull().primaryKey().defaultRandom(),
  /** ID вакансии на hh.ru */
  hhId: t.varchar({ length: 64 }).notNull().unique(),
  keywordId: t
    .uuid()
    .notNull()
    .references(() => SearchKeyword.id, { onDelete: "cascade" }),
  /** Категория (роль) вакансии; наследуется от keyword при скрапинге */
  categoryId: t.uuid().references(() => Category.id, { onDelete: "set null" }),
  title: t.varchar({ length: 512 }).notNull(),
  employerName: t.varchar({ length: 256 }),
  employerUrl: t.varchar({ length: 1024 }),
  employerLogoUrl: t.varchar({ length: 1024 }),
  /** Зарплата: { from, to, currency, gross } */
  salary: t.jsonb().$type<HhSalary>(),
  area: t.varchar({ length: 128 }),
  experience: t.varchar({ length: 64 }),
  employment: t.varchar({ length: 64 }),
  schedule: t.varchar({ length: 64 }),
  /** Требуемые навыки из hh.ru */
  skills: t.jsonb().$type<string[]>().default([]),
  /** Полное описание вакансии (HTML или plain text) */
  description: t.text(),
  url: t.varchar({ length: 1024 }).notNull(),
  publishedAt: t.timestamp({ mode: "date", withTimezone: true }),
  /** Вакансия ещё не просмотрена пользователем */
  isNew: t.boolean().default(true).notNull(),
  /** Вакансия скрыта / архивирована */
  isArchived: t.boolean().default(false).notNull(),
  createdAt: t.timestamp().defaultNow().notNull(),
}));

export const CreateVacancySchema = createInsertSchema(Vacancy).omit({
  id: true,
  createdAt: true,
});

export const SelectVacancySchema = createSelectSchema(Vacancy);

export type VacancyRow = typeof Vacancy.$inferSelect;
export type NewVacancy = typeof Vacancy.$inferInsert;
