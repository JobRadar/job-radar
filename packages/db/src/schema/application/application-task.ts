import { sql } from "drizzle-orm";
import { pgTable, uniqueIndex } from "drizzle-orm/pg-core";
import { createSelectSchema } from "drizzle-zod";

import { user } from "../auth/user";
import { Resume } from "../resume/resume";
import { Vacancy } from "../vacancy/vacancy";

/**
 * Статус задачи на отклик.
 *  todo    — отклик подготовлен, ждёт, пока пользователь отправит его вручную
 *  applied — пользователь отправил отклик
 *  skipped — пользователь отказался откликаться
 */
export const ApplicationTaskStatus = ["todo", "applied", "skipped"] as const;
export type ApplicationTaskStatusType = (typeof ApplicationTaskStatus)[number];

/**
 * Задача «откликнуться на вакансию».
 *
 * Создаётся фоновым воркфлоу `find-applications`: он подбирает вакансии,
 * подходящие под резюме пользователя, и генерирует для каждой сопроводительное
 * письмо. Пользователь открывает задачу в админке (в т.ч. с телефона),
 * копирует письмо, отправляет отклик на hh.ru и отмечает задачу выполненной.
 */
export const ApplicationTask = pgTable(
  "application_tasks",
  (t) => ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    userId: t
      .text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    resumeId: t
      .uuid()
      .notNull()
      .references(() => Resume.id, { onDelete: "cascade" }),
    vacancyId: t
      .uuid()
      .notNull()
      .references(() => Vacancy.id, { onDelete: "cascade" }),

    /** Очки соответствия 0–100 на момент создания задачи */
    score: t.integer().default(0).notNull(),
    /** Краткое обоснование, почему вакансия подходит */
    summary: t.text(),
    /** Сгенерированное сопроводительное письмо (plain text) */
    coverLetter: t.text().notNull().default(""),
    /** Модель LLM, написавшая письмо (для трассировки) */
    model: t.varchar({ length: 96 }),

    status: t
      .varchar({ length: 16 })
      .$type<ApplicationTaskStatusType>()
      .default("todo")
      .notNull(),
    /** Когда пользователь отметил отклик отправленным */
    appliedAt: t.timestamp({ mode: "date", withTimezone: true }),
    createdAt: t.timestamp().defaultNow().notNull(),
    updatedAt: t
      .timestamp({ mode: "date", withTimezone: true })
      .$onUpdateFn(() => sql`now()`),
  }),
  (table) => [
    // Одна задача на пару (резюме, вакансия): повторные прогоны не плодят дубли
    uniqueIndex("uniq_application_resume_vacancy").on(
      table.resumeId,
      table.vacancyId,
    ),
  ],
);

export const SelectApplicationTaskSchema = createSelectSchema(ApplicationTask);

export type ApplicationTaskRow = typeof ApplicationTask.$inferSelect;
export type NewApplicationTask = typeof ApplicationTask.$inferInsert;
