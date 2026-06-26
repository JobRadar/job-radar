import { sql } from "drizzle-orm";
import { pgTable } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod";

import { user } from "../auth/user";
import { Category } from "../category/category";

/**
 * Тип резюме.
 *  base      — реальный профиль пользователя (источник правды для генерации)
 *  generated — резюме, сгенерированное LLM под категорию на базе анализа рынка
 */
export const ResumeKind = ["base", "generated"] as const;
export type ResumeKindType = (typeof ResumeKind)[number];

/**
 * Персона сгенерированного резюме.
 *
 * Позволяет создавать вариации под разный профиль (в т.ч. вымышленный):
 * имя, возраст, годы опыта, локация. Для `base`-резюме обычно пусто.
 */
export interface ResumePersona {
  fullName?: string;
  age?: number;
  yearsOfExperience?: number;
  location?: string;
}

/**
 * Резюме пользователя.
 *
 * Текстовое резюме (заголовок + содержимое), которое пользователь
 * создаёт и хранит в системе для последующего отклика на вакансии.
 * Может быть базовым (`base`) или сгенерированным LLM (`generated`).
 */
export const Resume = pgTable("resumes", (t) => ({
  id: t.uuid().notNull().primaryKey().defaultRandom(),
  /** Владелец резюме */
  userId: t
    .text()
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  /** Категория (роль), под которую составлено резюме */
  categoryId: t.uuid().references(() => Category.id, { onDelete: "set null" }),
  /** Название резюме (например, «Frontend-разработчик») */
  title: t.varchar({ length: 256 }).notNull(),
  /** Содержимое резюме (текст / markdown) */
  content: t.text().notNull().default(""),
  /** Тип резюме: base | generated */
  kind: t
    .varchar({ length: 16 })
    .$type<ResumeKindType>()
    .default("base")
    .notNull(),
  /** Персона сгенерированного резюме (имя/возраст/опыт/локация) */
  persona: t.jsonb().$type<ResumePersona>(),
  /** Модель LLM, которой сгенерировано резюме (для трассировки) */
  model: t.varchar({ length: 96 }),
  /** Сколько вакансий легло в основу анализа при генерации */
  sourceVacancyCount: t.integer().default(0).notNull(),
  /** Резюме по умолчанию для откликов */
  isDefault: t.boolean().default(false).notNull(),
  createdAt: t.timestamp().defaultNow().notNull(),
  updatedAt: t
    .timestamp({ mode: "date", withTimezone: true })
    .$onUpdateFn(() => sql`now()`),
}));

export const CreateResumeSchema = createInsertSchema(Resume, {
  title: z.string().min(1).max(256),
  content: z.string().max(50_000),
}).omit({
  id: true,
  userId: true,
  createdAt: true,
  updatedAt: true,
});

export const SelectResumeSchema = createSelectSchema(Resume);

export type ResumeRow = typeof Resume.$inferSelect;
export type NewResume = typeof Resume.$inferInsert;
