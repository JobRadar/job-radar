import { pgTable } from "drizzle-orm/pg-core";
import { createSelectSchema } from "drizzle-zod";
import { SearchKeyword } from "./keyword";

export const ScrapeRunStatus = [
  "pending",
  "running",
  "completed",
  "failed",
] as const;
export type ScrapeRunStatusType = (typeof ScrapeRunStatus)[number];

/**
 * История запусков скрапера.
 * Каждый запуск привязан к конкретному ключевому слову.
 */
export const ScrapeRun = pgTable("scrape_runs", (t) => ({
  id: t.uuid().notNull().primaryKey().defaultRandom(),
  keywordId: t
    .uuid()
    .notNull()
    .references(() => SearchKeyword.id, { onDelete: "cascade" }),
  status: t
    .varchar({ length: 16 })
    .$type<ScrapeRunStatusType>()
    .default("pending")
    .notNull(),
  /** Всего вакансий найдено на страницах поиска */
  vacanciesFound: t.integer().default(0).notNull(),
  /** Из них новых (не было в БД) */
  vacanciesNew: t.integer().default(0).notNull(),
  /** Сообщение об ошибке при статусе failed */
  error: t.text(),
  /** Hatchet workflow run ID для трассировки */
  hatchetRunId: t.varchar({ length: 256 }),
  startedAt: t.timestamp().defaultNow().notNull(),
  completedAt: t.timestamp({ mode: "date", withTimezone: true }),
}));

export const SelectScrapeRunSchema = createSelectSchema(ScrapeRun);

export type ScrapeRunRow = typeof ScrapeRun.$inferSelect;
export type NewScrapeRun = typeof ScrapeRun.$inferInsert;
