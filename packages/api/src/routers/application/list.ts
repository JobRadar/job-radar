import { and, ApplicationTask, desc, eq, sql, Vacancy } from "@job-radar/db";
import { z } from "zod";

import { protectedProcedure } from "../../orpc";

/**
 * Задачи на отклик текущего пользователя.
 *
 * Сортировка: сначала самые подходящие (по очкам), затем самые свежие.
 * Вместе со списком возвращает счётчики по статусам — для вкладок.
 */
export const list = protectedProcedure
  .input(
    z.object({
      status: z.enum(["todo", "applied", "skipped"]).default("todo"),
      limit: z.number().min(1).max(100).default(30),
      offset: z.number().min(0).default(0),
    }),
  )
  .handler(async ({ context, input }) => {
    const { db, session } = context;
    const userId = session.user.id;

    const [items, counts] = await Promise.all([
      db
        .select({
          id: ApplicationTask.id,
          status: ApplicationTask.status,
          score: ApplicationTask.score,
          summary: ApplicationTask.summary,
          coverLetter: ApplicationTask.coverLetter,
          createdAt: ApplicationTask.createdAt,
          appliedAt: ApplicationTask.appliedAt,
          vacancyId: Vacancy.id,
          vacancyTitle: Vacancy.title,
          vacancyUrl: Vacancy.url,
          employerName: Vacancy.employerName,
          salary: Vacancy.salary,
          area: Vacancy.area,
          schedule: Vacancy.schedule,
          isVacancyArchived: Vacancy.isArchived,
        })
        .from(ApplicationTask)
        .innerJoin(Vacancy, eq(ApplicationTask.vacancyId, Vacancy.id))
        .where(
          and(
            eq(ApplicationTask.userId, userId),
            eq(ApplicationTask.status, input.status),
          ),
        )
        .orderBy(desc(ApplicationTask.score), desc(ApplicationTask.createdAt))
        .limit(input.limit)
        .offset(input.offset),
      db
        .select({
          status: ApplicationTask.status,
          count: sql<number>`count(*)::int`,
        })
        .from(ApplicationTask)
        .where(eq(ApplicationTask.userId, userId))
        .groupBy(ApplicationTask.status),
    ]);

    const countByStatus = { todo: 0, applied: 0, skipped: 0 };
    for (const row of counts) {
      countByStatus[row.status] = row.count;
    }

    return { items, counts: countByStatus, total: countByStatus[input.status] };
  });
