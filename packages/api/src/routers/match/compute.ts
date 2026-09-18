import { scoreResumeVacancy } from "@job-radar/ai";
import {
  and,
  eq,
  inArray,
  Resume,
  ResumeVacancyMatch,
  SearchKeyword,
  Vacancy,
} from "@job-radar/db";
import { ORPCError } from "@orpc/server";
import { z } from "zod";

import { protectedProcedure } from "../../orpc";

/**
 * Массовая оценка резюме против вакансий его категории (синхронно, батчем).
 *
 * Ограничена `limit` вакансий за вызов, чтобы запрос не висел слишком долго.
 * Для полной фоновой обработки используйте воркфлоу `score-resume-matches`.
 */
export const compute = protectedProcedure
  .input(
    z.object({
      resumeId: z.string().uuid(),
      limit: z.number().min(1).max(20).default(10),
      rescoreAll: z.boolean().default(false),
    }),
  )
  .handler(async ({ context, input }) => {
    const { db, session } = context;
    const userId = session.user.id;

    const resume = await db.query.Resume.findFirst({
      where: and(eq(Resume.id, input.resumeId), eq(Resume.userId, userId)),
      columns: { id: true, content: true, categoryId: true },
    });
    if (!resume) {
      throw new ORPCError("NOT_FOUND", { message: "Резюме не найдено" });
    }
    if (!resume.categoryId) {
      throw new ORPCError("BAD_REQUEST", {
        message: "У резюме не указана категория — нечего оценивать",
      });
    }

    // Вакансии категории, принадлежащие пользователю
    const vacancies = await db
      .select({ id: Vacancy.id })
      .from(Vacancy)
      .innerJoin(SearchKeyword, eq(Vacancy.keywordId, SearchKeyword.id))
      .where(
        and(
          eq(SearchKeyword.userId, userId),
          eq(Vacancy.categoryId, resume.categoryId),
          eq(Vacancy.isArchived, false),
        ),
      );

    if (vacancies.length > 0) {
      await db
        .insert(ResumeVacancyMatch)
        .values(
          vacancies.map((v) => ({
            resumeId: resume.id,
            vacancyId: v.id,
            userId,
            status: "pending" as const,
          })),
        )
        .onConflictDoNothing({
          target: [ResumeVacancyMatch.resumeId, ResumeVacancyMatch.vacancyId],
        });
    }

    const statusCondition = input.rescoreAll
      ? eq(ResumeVacancyMatch.resumeId, resume.id)
      : and(
          eq(ResumeVacancyMatch.resumeId, resume.id),
          eq(ResumeVacancyMatch.status, "pending"),
        );

    const pending = await db
      .select({ id: ResumeVacancyMatch.id })
      .from(ResumeVacancyMatch)
      .where(statusCondition)
      .limit(input.limit);

    if (pending.length === 0) {
      return { scored: 0, failed: 0, total: 0, remainingPending: 0 };
    }

    const matchIds = pending.map((m) => m.id);

    const rows = await db
      .select({
        matchId: ResumeVacancyMatch.id,
        title: Vacancy.title,
        skills: Vacancy.skills,
        description: Vacancy.description,
        experience: Vacancy.experience,
        employerName: Vacancy.employerName,
      })
      .from(ResumeVacancyMatch)
      .innerJoin(Vacancy, eq(ResumeVacancyMatch.vacancyId, Vacancy.id))
      .where(inArray(ResumeVacancyMatch.id, matchIds));

    let scored = 0;
    let failed = 0;

    for (const row of rows) {
      try {
        const result = await scoreResumeVacancy({
          resumeContent: resume.content,
          vacancy: {
            title: row.title,
            skills: row.skills ?? [],
            description: row.description,
            experience: row.experience,
            employerName: row.employerName,
          },
        });

        await db
          .update(ResumeVacancyMatch)
          .set({
            score: result.score,
            summary: result.summary,
            details: {
              matchedSkills: result.matchedSkills,
              missingSkills: result.missingSkills,
              pros: result.pros,
              cons: result.cons,
            },
            model: result.model,
            status: "scored",
            error: null,
          })
          .where(eq(ResumeVacancyMatch.id, row.matchId));
        scored++;
      } catch (err) {
        await db
          .update(ResumeVacancyMatch)
          .set({
            status: "failed",
            error: err instanceof Error ? err.message : String(err),
          })
          .where(eq(ResumeVacancyMatch.id, row.matchId));
        failed++;
      }
    }

    // Сколько ещё осталось в очереди (pending) после этого батча
    const remaining = await db
      .select({ id: ResumeVacancyMatch.id })
      .from(ResumeVacancyMatch)
      .where(
        and(
          eq(ResumeVacancyMatch.resumeId, resume.id),
          eq(ResumeVacancyMatch.status, "pending"),
        ),
      );

    return {
      scored,
      failed,
      total: rows.length,
      remainingPending: remaining.length,
    };
  });
