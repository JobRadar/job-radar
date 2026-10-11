import { generateCoverLetter, scoreResumeVacancy } from "@job-radar/ai";
import { and, desc, eq, inArray, isNull, or, sql } from "@job-radar/db";
import { db } from "@job-radar/db/client";
import {
  ApplicationTask,
  Resume,
  ResumeVacancyMatch,
  SearchKeyword,
  Vacancy,
} from "@job-radar/db/schema";
import { hatchet } from "../client";

export interface FindApplicationsInput {
  /** Владелец: подбираем вакансии среди его ключевых слов */
  userId: string;
  /**
   * Резюме, под которое ищем. Если не указано — основное (isDefault),
   * а при его отсутствии — самое свежее базовое резюме пользователя.
   */
  resumeId?: string;
  /** Минимальные очки соответствия (0–100) для создания задачи. По умолчанию 70 */
  minScore?: number;
  /** Максимум новых задач за прогон (каждая = письмо от LLM). По умолчанию 10 */
  maxTasks?: number;
  /** Максимум вакансий, которые рассматриваем за прогон (бюджет LLM). По умолчанию 40 */
  candidateLimit?: number;
  /** Идентификатор модели OpenRouter (по умолчанию из env) */
  modelId?: string;
}

const DEFAULT_MIN_SCORE = 70;
const DEFAULT_MAX_TASKS = 10;
const DEFAULT_CANDIDATE_LIMIT = 40;

/**
 * Workflow «найти вакансии под резюме и подготовить отклики».
 *
 * DAG:
 *  select-candidates → score-candidates → create-tasks
 *
 * Результат — записи `ApplicationTask` (статус `todo`) с сопроводительным
 * письмом. Сам отклик на hh.ru пользователь отправляет вручную из админки.
 *
 * Запуск:
 * ```ts
 * import { findApplicationsWorkflow } from "@job-radar/jobs";
 * await findApplicationsWorkflow.run({ userId: "..." });
 * ```
 */
export const findApplicationsWorkflow = hatchet.workflow({
  name: "find-applications",
});

// ── Шаг 1: выбор резюме и вакансий-кандидатов ──────────────────────────────
const selectCandidates = findApplicationsWorkflow.task({
  name: "select-candidates",
  retries: 1,
  executionTimeout: "60s",
  fn: async (rawInput) => {
    const input = rawInput as unknown as FindApplicationsInput;
    const minScore = input.minScore ?? DEFAULT_MIN_SCORE;
    const limit = input.candidateLimit ?? DEFAULT_CANDIDATE_LIMIT;

    const resume = input.resumeId
      ? await db.query.Resume.findFirst({
          where: and(
            eq(Resume.id, input.resumeId),
            eq(Resume.userId, input.userId),
          ),
          columns: { id: true, categoryId: true },
        })
      : await db.query.Resume.findFirst({
          where: and(
            eq(Resume.userId, input.userId),
            or(eq(Resume.isDefault, true), eq(Resume.kind, "base")),
          ),
          orderBy: [desc(Resume.isDefault), desc(Resume.createdAt)],
          columns: { id: true, categoryId: true },
        });

    if (!resume) {
      throw new Error(
        `У пользователя ${input.userId} нет резюме для подбора вакансий`,
      );
    }

    // Вакансии пользователя (через keyword), на которые ещё нет задачи.
    // Уже оценённые как неподходящие (score < minScore) пропускаем — не
    // тратим на них LLM повторно. Сначала берём уже оценённые подходящие
    // (они бесплатны), затем самые свежие неоценённые.
    const rows = await db
      .select({ id: Vacancy.id })
      .from(Vacancy)
      .innerJoin(SearchKeyword, eq(Vacancy.keywordId, SearchKeyword.id))
      .leftJoin(
        ResumeVacancyMatch,
        and(
          eq(ResumeVacancyMatch.vacancyId, Vacancy.id),
          eq(ResumeVacancyMatch.resumeId, resume.id),
        ),
      )
      .leftJoin(
        ApplicationTask,
        and(
          eq(ApplicationTask.vacancyId, Vacancy.id),
          eq(ApplicationTask.resumeId, resume.id),
        ),
      )
      .where(
        and(
          eq(SearchKeyword.userId, input.userId),
          eq(Vacancy.isArchived, false),
          resume.categoryId
            ? eq(Vacancy.categoryId, resume.categoryId)
            : undefined,
          isNull(ApplicationTask.id),
          or(
            isNull(ResumeVacancyMatch.id),
            sql`${ResumeVacancyMatch.status} <> 'scored'`,
            sql`${ResumeVacancyMatch.score} >= ${minScore}`,
          ),
        ),
      )
      .orderBy(
        sql`(${ResumeVacancyMatch.status} = 'scored') desc nulls last`,
        desc(Vacancy.createdAt),
      )
      .limit(limit);

    return { resumeId: resume.id, vacancyIds: rows.map((r) => r.id) };
  },
});

// ── Шаг 2: оценка соответствия кандидатов через LLM ────────────────────────
const scoreCandidates = findApplicationsWorkflow.task({
  name: "score-candidates",
  parents: [selectCandidates],
  retries: 1,
  executionTimeout: "30m",
  fn: async (rawInput, ctx) => {
    const input = rawInput as unknown as FindApplicationsInput;
    const minScore = input.minScore ?? DEFAULT_MIN_SCORE;
    const { resumeId, vacancyIds } = await ctx.parentOutput(selectCandidates);

    if (vacancyIds.length === 0) {
      return { resumeId, qualified: [] as string[], scored: 0, failed: 0 };
    }

    const resume = await db.query.Resume.findFirst({
      where: eq(Resume.id, resumeId),
      columns: { content: true },
    });
    const resumeContent = resume?.content ?? "";

    const existing = await db
      .select({
        vacancyId: ResumeVacancyMatch.vacancyId,
        score: ResumeVacancyMatch.score,
        status: ResumeVacancyMatch.status,
      })
      .from(ResumeVacancyMatch)
      .where(
        and(
          eq(ResumeVacancyMatch.resumeId, resumeId),
          inArray(ResumeVacancyMatch.vacancyId, vacancyIds),
        ),
      );
    const scoredById = new Map(
      existing
        .filter((m) => m.status === "scored")
        .map((m) => [m.vacancyId, m]),
    );

    const unscoredIds = vacancyIds.filter((id) => !scoredById.has(id));
    const toScore =
      unscoredIds.length === 0
        ? []
        : await db
            .select({
              id: Vacancy.id,
              title: Vacancy.title,
              skills: Vacancy.skills,
              description: Vacancy.description,
              experience: Vacancy.experience,
              employerName: Vacancy.employerName,
            })
            .from(Vacancy)
            .where(inArray(Vacancy.id, unscoredIds));

    // Уже оценённые подходящие вакансии идут в задачи без повторного LLM
    const qualified = new Set<string>(
      [...scoredById.values()]
        .filter((m) => m.score >= minScore)
        .map((m) => m.vacancyId),
    );
    let scored = 0;
    let failed = 0;

    for (const v of toScore) {
      try {
        const result = await scoreResumeVacancy({
          resumeContent,
          vacancy: {
            title: v.title,
            skills: v.skills ?? [],
            description: v.description,
            experience: v.experience,
            employerName: v.employerName,
          },
          modelId: input.modelId,
        });

        const values = {
          score: Math.round(result.score),
          summary: result.summary,
          details: {
            matchedSkills: result.matchedSkills,
            missingSkills: result.missingSkills,
            pros: result.pros,
            cons: result.cons,
          },
          model: result.model,
          status: "scored" as const,
          error: null,
        };

        await db
          .insert(ResumeVacancyMatch)
          .values({
            resumeId,
            vacancyId: v.id,
            userId: input.userId,
            ...values,
          })
          .onConflictDoUpdate({
            target: [ResumeVacancyMatch.resumeId, ResumeVacancyMatch.vacancyId],
            set: values,
          });

        scored++;
        if (values.score >= minScore) qualified.add(v.id);
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        await db
          .insert(ResumeVacancyMatch)
          .values({
            resumeId,
            vacancyId: v.id,
            userId: input.userId,
            status: "failed",
            error,
          })
          .onConflictDoUpdate({
            target: [ResumeVacancyMatch.resumeId, ResumeVacancyMatch.vacancyId],
            set: { status: "failed", error },
          });
        failed++;
      }
    }

    return { resumeId, qualified: [...qualified], scored, failed };
  },
});

// ── Шаг 3: письма и задачи на отклик ───────────────────────────────────────
findApplicationsWorkflow.task({
  name: "create-tasks",
  parents: [scoreCandidates],
  retries: 1,
  executionTimeout: "15m",
  fn: async (rawInput, ctx) => {
    const input = rawInput as unknown as FindApplicationsInput;
    const maxTasks = input.maxTasks ?? DEFAULT_MAX_TASKS;
    const { resumeId, qualified } = await ctx.parentOutput(scoreCandidates);

    if (qualified.length === 0) {
      return { created: 0, failed: 0, qualified: 0 };
    }

    const resume = await db.query.Resume.findFirst({
      where: eq(Resume.id, resumeId),
      columns: { content: true },
    });
    const resumeContent = resume?.content ?? "";

    // Лучшие по очкам — первыми; остальные подхватит следующий прогон
    // (у них уже есть оценка, повторно LLM для скоринга не потребуется).
    const rows = await db
      .select({
        vacancyId: Vacancy.id,
        title: Vacancy.title,
        skills: Vacancy.skills,
        description: Vacancy.description,
        experience: Vacancy.experience,
        employerName: Vacancy.employerName,
        score: ResumeVacancyMatch.score,
        summary: ResumeVacancyMatch.summary,
        details: ResumeVacancyMatch.details,
      })
      .from(ResumeVacancyMatch)
      .innerJoin(Vacancy, eq(ResumeVacancyMatch.vacancyId, Vacancy.id))
      .where(
        and(
          eq(ResumeVacancyMatch.resumeId, resumeId),
          inArray(ResumeVacancyMatch.vacancyId, qualified),
        ),
      )
      .orderBy(desc(ResumeVacancyMatch.score))
      .limit(maxTasks);

    let created = 0;
    let failed = 0;

    for (const row of rows) {
      try {
        const letter = await generateCoverLetter({
          resumeContent,
          vacancy: {
            title: row.title,
            skills: row.skills ?? [],
            description: row.description,
            experience: row.experience,
            employerName: row.employerName,
          },
          matchedSkills: row.details?.matchedSkills,
          pros: row.details?.pros,
          modelId: input.modelId,
        });

        const inserted = await db
          .insert(ApplicationTask)
          .values({
            userId: input.userId,
            resumeId,
            vacancyId: row.vacancyId,
            score: row.score,
            summary: row.summary,
            coverLetter: letter.letter,
            model: letter.model,
          })
          .onConflictDoNothing({
            target: [ApplicationTask.resumeId, ApplicationTask.vacancyId],
          })
          .returning({ id: ApplicationTask.id });

        if (inserted.length > 0) created++;
      } catch {
        // Задачу не создаём — вакансия останется «готовой» и будет подобрана
        // следующим прогоном, когда LLM снова ответит.
        failed++;
      }
    }

    return { created, failed, qualified: qualified.length };
  },
});
