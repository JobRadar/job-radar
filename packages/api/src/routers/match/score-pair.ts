import { scoreResumeVacancy } from "@job-radar/ai";
import {
  and,
  eq,
  Resume,
  ResumeVacancyMatch,
  SearchKeyword,
  Vacancy,
} from "@job-radar/db";
import { ORPCError } from "@orpc/server";
import { z } from "zod";

import { protectedProcedure } from "../../orpc";

/**
 * Оценить одну пару (резюме, вакансия) синхронно через LLM и сохранить результат.
 *
 * Используется для точечной оценки по запросу. Массовый скоринг — через
 * `match.compute` или фоновый воркфлоу `score-resume-matches`.
 */
export const scorePair = protectedProcedure
  .input(
    z.object({
      resumeId: z.string().uuid(),
      vacancyId: z.string().uuid(),
    }),
  )
  .handler(async ({ context, input }) => {
    const { db, session } = context;
    const userId = session.user.id;

    const resume = await db.query.Resume.findFirst({
      where: and(eq(Resume.id, input.resumeId), eq(Resume.userId, userId)),
      columns: { id: true, content: true },
    });
    if (!resume) {
      throw new ORPCError("NOT_FOUND", { message: "Резюме не найдено" });
    }

    // Вакансия должна принадлежать пользователю (через keyword)
    const [vacancy] = await db
      .select({
        id: Vacancy.id,
        title: Vacancy.title,
        skills: Vacancy.skills,
        description: Vacancy.description,
        experience: Vacancy.experience,
        employerName: Vacancy.employerName,
      })
      .from(Vacancy)
      .innerJoin(SearchKeyword, eq(Vacancy.keywordId, SearchKeyword.id))
      .where(
        and(eq(Vacancy.id, input.vacancyId), eq(SearchKeyword.userId, userId)),
      )
      .limit(1);

    if (!vacancy) {
      throw new ORPCError("NOT_FOUND", { message: "Вакансия не найдена" });
    }

    let result: Awaited<ReturnType<typeof scoreResumeVacancy>>;
    try {
      result = await scoreResumeVacancy({
        resumeContent: resume.content,
        vacancy: {
          title: vacancy.title,
          skills: vacancy.skills ?? [],
          description: vacancy.description,
          experience: vacancy.experience,
          employerName: vacancy.employerName,
        },
      });
    } catch (err) {
      throw new ORPCError("INTERNAL_SERVER_ERROR", {
        message: `Ошибка LLM при оценке: ${
          err instanceof Error ? err.message : String(err)
        }`,
      });
    }

    const [match] = await db
      .insert(ResumeVacancyMatch)
      .values({
        resumeId: resume.id,
        vacancyId: vacancy.id,
        userId,
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
      })
      .onConflictDoUpdate({
        target: [ResumeVacancyMatch.resumeId, ResumeVacancyMatch.vacancyId],
        set: {
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
        },
      })
      .returning();

    return match;
  });
