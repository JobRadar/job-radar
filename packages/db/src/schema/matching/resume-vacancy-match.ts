import { sql } from "drizzle-orm";
import { pgTable, uniqueIndex } from "drizzle-orm/pg-core";
import { createSelectSchema } from "drizzle-zod";

import { user } from "../auth/user";
import { Resume } from "../resume/resume";
import { Vacancy } from "../vacancy/vacancy";

/**
 * Статус расчёта оценки соответствия.
 *  pending — пара создана, ждёт обработки LLM
 *  scored  — оценка получена
 *  failed  — LLM вернул ошибку
 */
export const MatchStatus = ["pending", "scored", "failed"] as const;
export type MatchStatusType = (typeof MatchStatus)[number];

/**
 * Детализация оценки соответствия от LLM.
 */
export interface MatchDetails {
  /** Навыки из вакансии, которые покрыты резюме */
  matchedSkills: string[];
  /** Навыки из вакансии, которых не хватает в резюме */
  missingSkills: string[];
  /** Сильные стороны кандидата под эту вакансию */
  pros: string[];
  /** Слабые стороны / риски */
  cons: string[];
}

/**
 * Оценка соответствия конкретного резюме конкретной вакансии.
 *
 * Хранится в отдельной таблице: на каждую пару (резюме, вакансия) —
 * одна запись с очками 0–100, сводкой и детализацией от LLM.
 * Используется и как метрика качества сгенерированного резюме
 * (насколько оно покрывает рынок вакансий категории).
 */
export const ResumeVacancyMatch = pgTable(
  "resume_vacancy_matches",
  (t) => ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    resumeId: t
      .uuid()
      .notNull()
      .references(() => Resume.id, { onDelete: "cascade" }),
    vacancyId: t
      .uuid()
      .notNull()
      .references(() => Vacancy.id, { onDelete: "cascade" }),
    /** Денормализованный владелец — для быстрой фильтрации «мои оценки» */
    userId: t
      .text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),

    /** Очки соответствия 0–100 (выставляет LLM) */
    score: t.integer().default(0).notNull(),
    /** Краткое обоснование оценки */
    summary: t.text(),
    /** Детализация: { matchedSkills, missingSkills, pros, cons } */
    details: t.jsonb().$type<MatchDetails>(),
    /** Использованная модель LLM (для трассировки), напр. "openai/gpt-4o-mini" */
    model: t.varchar({ length: 96 }),
    status: t
      .varchar({ length: 16 })
      .$type<MatchStatusType>()
      .default("pending")
      .notNull(),
    /** Текст ошибки при status = failed */
    error: t.text(),
    createdAt: t.timestamp().defaultNow().notNull(),
    updatedAt: t
      .timestamp({ mode: "date", withTimezone: true })
      .$onUpdateFn(() => sql`now()`),
  }),
  (table) => [
    // Одна оценка на пару (резюме, вакансия)
    uniqueIndex("uniq_resume_vacancy").on(table.resumeId, table.vacancyId),
  ],
);

export const SelectResumeVacancyMatchSchema =
  createSelectSchema(ResumeVacancyMatch);

export type ResumeVacancyMatchRow = typeof ResumeVacancyMatch.$inferSelect;
export type NewResumeVacancyMatch = typeof ResumeVacancyMatch.$inferInsert;
