import { and, desc, eq, ResumeVacancyMatch, sql, Vacancy } from "@job-radar/db";
import { z } from "zod";

import { protectedProcedure } from "../../orpc";

/**
 * Оценки соответствия для конкретного резюме.
 * Сортировка по убыванию очков; присоединяется базовая инфо о вакансии.
 */
export const list = protectedProcedure
  .input(
    z.object({
      resumeId: z.string().uuid(),
      limit: z.number().min(1).max(100).default(50),
      offset: z.number().min(0).default(0),
      status: z.enum(["all", "pending", "scored", "failed"]).default("all"),
    }),
  )
  .handler(async ({ context, input }) => {
    const { db, session } = context;
    const userId = session.user.id;

    const conditions = [
      eq(ResumeVacancyMatch.userId, userId),
      eq(ResumeVacancyMatch.resumeId, input.resumeId),
    ];
    if (input.status !== "all") {
      conditions.push(eq(ResumeVacancyMatch.status, input.status));
    }
    const whereClause = and(...conditions);

    const [items, countResult] = await Promise.all([
      db
        .select({
          id: ResumeVacancyMatch.id,
          resumeId: ResumeVacancyMatch.resumeId,
          vacancyId: ResumeVacancyMatch.vacancyId,
          score: ResumeVacancyMatch.score,
          summary: ResumeVacancyMatch.summary,
          details: ResumeVacancyMatch.details,
          status: ResumeVacancyMatch.status,
          model: ResumeVacancyMatch.model,
          updatedAt: ResumeVacancyMatch.updatedAt,
          vacancyTitle: Vacancy.title,
          employerName: Vacancy.employerName,
          vacancyUrl: Vacancy.url,
        })
        .from(ResumeVacancyMatch)
        .innerJoin(Vacancy, eq(ResumeVacancyMatch.vacancyId, Vacancy.id))
        .where(whereClause)
        .orderBy(
          desc(ResumeVacancyMatch.score),
          desc(ResumeVacancyMatch.updatedAt),
        )
        .limit(input.limit)
        .offset(input.offset),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(ResumeVacancyMatch)
        .where(whereClause),
    ]);

    return { items, total: countResult[0]?.count ?? 0 };
  });
