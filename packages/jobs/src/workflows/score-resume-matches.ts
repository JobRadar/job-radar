import { scoreResumeVacancy } from "@job-radar/ai";
import { and, eq, inArray } from "@job-radar/db";
import { db } from "@job-radar/db/client";
import {
  Resume,
  ResumeVacancyMatch,
  SearchKeyword,
  Vacancy,
} from "@job-radar/db/schema";
import { hatchet } from "../client";

export interface ScoreResumeMatchesInput {
  /** UUID резюме, которое оцениваем */
  resumeId: string;
  /** Максимум вакансий за один прогон (ограничение бюджета LLM) */
  limit?: number;
  /** Переоценить уже оценённые пары (по умолчанию только pending/новые) */
  rescoreAll?: boolean;
  /** Идентификатор модели OpenRouter (по умолчанию из env) */
  modelId?: string;
}

const DEFAULT_LIMIT = 25;

/**
 * Workflow массового скоринга резюме против вакансий его категории.
 *
 * DAG:
 *  prepare-matches → score-pending → finalize
 *
 * Запуск:
 * ```ts
 * import { scoreResumeMatchesWorkflow } from "@job-radar/jobs";
 * await scoreResumeMatchesWorkflow.run({ resumeId: "..." });
 * ```
 */
export const scoreResumeMatchesWorkflow = hatchet.workflow({
  name: "score-resume-matches",
});

// ── Шаг 1: подготовка пар (резюме, вакансия) ───────────────────────────────
const prepareMatches = scoreResumeMatchesWorkflow.task({
  name: "prepare-matches",
  retries: 1,
  executionTimeout: "60s",
  fn: async (rawInput) => {
    const input = rawInput as unknown as ScoreResumeMatchesInput;
    const limit = input.limit ?? DEFAULT_LIMIT;

    const resume = await db.query.Resume.findFirst({
      where: eq(Resume.id, input.resumeId),
      columns: { id: true, userId: true, categoryId: true },
    });

    if (!resume) {
      throw new Error(`Резюме ${input.resumeId} не найдено`);
    }
    if (!resume.categoryId) {
      throw new Error(
        `У резюме ${input.resumeId} не указана категория — нечего оценивать`,
      );
    }

    // Вакансии категории, принадлежащие пользователю (через keyword)
    const vacancies = await db
      .select({ id: Vacancy.id })
      .from(Vacancy)
      .innerJoin(SearchKeyword, eq(Vacancy.keywordId, SearchKeyword.id))
      .where(
        and(
          eq(SearchKeyword.userId, resume.userId),
          eq(Vacancy.categoryId, resume.categoryId),
          eq(Vacancy.isArchived, false),
        ),
      );

    if (vacancies.length === 0) {
      return { resumeId: resume.id, matchIds: [] as string[] };
    }

    // Создаём pending-записи на каждую пару (идемпотентно по uniq индексу)
    await db
      .insert(ResumeVacancyMatch)
      .values(
        vacancies.map((v) => ({
          resumeId: resume.id,
          vacancyId: v.id,
          userId: resume.userId,
          status: "pending" as const,
        })),
      )
      .onConflictDoNothing({
        target: [ResumeVacancyMatch.resumeId, ResumeVacancyMatch.vacancyId],
      });

    // Выбираем, что обрабатывать в этом прогоне
    const statusFilter = input.rescoreAll
      ? undefined
      : eq(ResumeVacancyMatch.status, "pending");

    const toProcess = await db
      .select({ id: ResumeVacancyMatch.id })
      .from(ResumeVacancyMatch)
      .where(
        statusFilter
          ? and(eq(ResumeVacancyMatch.resumeId, resume.id), statusFilter)
          : eq(ResumeVacancyMatch.resumeId, resume.id),
      )
      .limit(limit);

    return {
      resumeId: resume.id,
      matchIds: toProcess.map((m) => m.id),
    };
  },
});

// ── Шаг 2: скоринг через LLM ────────────────────────────────────────────────
const scorePending = scoreResumeMatchesWorkflow.task({
  name: "score-pending",
  parents: [prepareMatches],
  retries: 1,
  executionTimeout: "30m",
  fn: async (rawInput, ctx) => {
    const input = rawInput as unknown as ScoreResumeMatchesInput;
    const { resumeId, matchIds } = await ctx.parentOutput(prepareMatches);

    if (matchIds.length === 0) {
      return { scored: 0, failed: 0, total: 0 };
    }

    const resume = await db.query.Resume.findFirst({
      where: eq(Resume.id, resumeId),
      columns: { content: true },
    });
    const resumeContent = resume?.content ?? "";

    const matches = await db
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

    for (const m of matches) {
      try {
        const result = await scoreResumeVacancy({
          resumeContent,
          vacancy: {
            title: m.title,
            skills: m.skills ?? [],
            description: m.description,
            experience: m.experience,
            employerName: m.employerName,
          },
          modelId: input.modelId,
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
          .where(eq(ResumeVacancyMatch.id, m.matchId));
        scored++;
      } catch (err) {
        await db
          .update(ResumeVacancyMatch)
          .set({
            status: "failed",
            error: err instanceof Error ? err.message : String(err),
          })
          .where(eq(ResumeVacancyMatch.id, m.matchId));
        failed++;
      }
    }

    return { scored, failed, total: matches.length };
  },
});

// ── Шаг 3: финализация ──────────────────────────────────────────────────────
scoreResumeMatchesWorkflow.task({
  name: "finalize",
  parents: [scorePending],
  retries: 1,
  executionTimeout: "15s",
  fn: async (_rawInput, ctx) => {
    const { scored, failed, total } = await ctx.parentOutput(scorePending);
    return { scored, failed, total };
  },
});
