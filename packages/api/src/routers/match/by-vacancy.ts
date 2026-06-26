import { and, desc, eq, Resume, ResumeVacancyMatch } from "@job-radar/db";
import { z } from "zod";

import { protectedProcedure } from "../../orpc";

/**
 * Оценки соответствия всех резюме пользователя для одной вакансии.
 * Помогает понять, какое резюме лучше подходит под конкретную вакансию.
 */
export const byVacancy = protectedProcedure
  .input(z.object({ vacancyId: z.string().uuid() }))
  .handler(async ({ context, input }) => {
    const { db, session } = context;

    const items = await db
      .select({
        id: ResumeVacancyMatch.id,
        resumeId: ResumeVacancyMatch.resumeId,
        score: ResumeVacancyMatch.score,
        summary: ResumeVacancyMatch.summary,
        status: ResumeVacancyMatch.status,
        resumeTitle: Resume.title,
        resumeKind: Resume.kind,
      })
      .from(ResumeVacancyMatch)
      .innerJoin(Resume, eq(ResumeVacancyMatch.resumeId, Resume.id))
      .where(
        and(
          eq(ResumeVacancyMatch.userId, session.user.id),
          eq(ResumeVacancyMatch.vacancyId, input.vacancyId),
        ),
      )
      .orderBy(desc(ResumeVacancyMatch.score));

    return { items };
  });
