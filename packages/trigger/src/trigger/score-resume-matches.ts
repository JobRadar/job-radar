import { scoreResumeVacancy } from "@job-radar/ai";
import { and, eq, inArray } from "@job-radar/db";
import { db } from "@job-radar/db/client";
import {
  Resume,
  ResumeVacancyMatch,
  SearchKeyword,
  Vacancy,
} from "@job-radar/db/schema";
import { logger, task } from "@trigger.dev/sdk";

export interface ScoreResumeMatchesInput {
  /** UUID резюме, которое оцениваем */
  resumeId: string;
  /** Максимум вакансий за один прогон (ограничение бюджета LLM) */
  limit?: number;
  /** Переоценить уже оценённые пары (по умолчанию только pending/новые) */
  rescoreAll?: boolean;
  /** Идентификатор LLM-модели (по умолчанию из env) */
  modelId?: string;
}

const DEFAULT_LIMIT = 25;

/**
 * Массовый скоринг резюме против вакансий его категории.
 *
 * Шаги: подготовка пар (резюме, вакансия) → скоринг через LLM → итог.
 *
 * Запуск из приложения:
 * ```ts
 * import type { scoreResumeMatchesTask } from "@job-radar/trigger";
 * import { tasks } from "@trigger.dev/sdk";
 * await tasks.trigger<typeof scoreResumeMatchesTask>("score-resume-matches", { resumeId });
 * ```
 */
export const scoreResumeMatchesTask = task({
  id: "score-resume-matches",
  maxDuration: 1800,
  retry: { maxAttempts: 2 },
  run: async (input: ScoreResumeMatchesInput) => {
    const matchIds = await prepareMatches(input);

    if (matchIds.length === 0) {
      return { scored: 0, failed: 0, total: 0 };
    }

    return scorePending(input, matchIds);
  },
});

// ── Шаг 1: подготовка пар (резюме, вакансия) ───────────────────────────────
async function prepareMatches(input: ScoreResumeMatchesInput) {
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
    return [] as string[];
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

  logger.log("Пары подготовлены", {
    resumeId: resume.id,
    toProcess: toProcess.length,
  });

  return toProcess.map((m) => m.id);
}

// ── Шаг 2: скоринг через LLM ────────────────────────────────────────────────
async function scorePending(
  input: ScoreResumeMatchesInput,
  matchIds: string[],
) {
  const resume = await db.query.Resume.findFirst({
    where: eq(Resume.id, input.resumeId),
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
      logger.error("Не удалось оценить пару", {
        matchId: m.matchId,
        error: err instanceof Error ? err.message : String(err),
      });
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
}
