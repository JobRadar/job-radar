import { sql } from "drizzle-orm";
import { pgTable } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod";

import { user } from "../auth/user";

/**
 * Резюме пользователя.
 *
 * Текстовое резюме (заголовок + содержимое), которое пользователь
 * создаёт и хранит в системе для последующего отклика на вакансии.
 */
export const Resume = pgTable("resumes", (t) => ({
  id: t.uuid().notNull().primaryKey().defaultRandom(),
  /** Владелец резюме */
  userId: t
    .text()
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  /** Название резюме (например, «Frontend-разработчик») */
  title: t.varchar({ length: 256 }).notNull(),
  /** Содержимое резюме (текст / markdown) */
  content: t.text().notNull().default(""),
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
