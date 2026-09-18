import {
  analyzeMarket,
  type CreativityLevel,
  generateResume,
  type Persona,
} from "@job-radar/ai";
import { and, eq } from "@job-radar/db";
import { db } from "@job-radar/db/client";
import { Category, Resume, SearchKeyword, Vacancy } from "@job-radar/db/schema";
import { hatchet } from "../client";

export interface GenerateResumeJobInput {
  /** Владелец резюме */
  userId: string;
  /** Категория (роль), под которую генерируем */
  categoryId: string;
  /** Базовое резюме — источник реального профиля (опционально) */
  baseResumeId?: string;
  /** Целевая персона (имя/возраст/опыт/локация) */
  persona?: Persona;
  /** Степень творчества/выдумки */
  creativity?: CreativityLevel;
  /** Язык резюме */
  language?: string;
  /** Идентификатор модели OpenRouter */
  modelId?: string;
}

/**
 * Workflow генерации резюме под категорию на основе спарсенных вакансий.
 *
 * DAG:
 *  analyze-market → generate-and-save
 *
 * Запуск:
 * ```ts
 * import { generateResumeWorkflow } from "@job-radar/jobs";
 * await generateResumeWorkflow.run({ userId, categoryId, creativity: "balanced" });
 * ```
 */
export const generateResumeWorkflow = hatchet.workflow({
  name: "generate-resume",
});

// ── Шаг 1: анализ рынка вакансий категории ─────────────────────────────────
const analyzeMarketStep = generateResumeWorkflow.task({
  name: "analyze-market",
  retries: 1,
  executionTimeout: "60s",
  fn: async (rawInput) => {
    const input = rawInput as unknown as GenerateResumeJobInput;

    const category = await db.query.Category.findFirst({
      where: eq(Category.id, input.categoryId),
    });
    if (!category) {
      throw new Error(`Категория ${input.categoryId} не найдена`);
    }

    const vacancies = await db
      .select({
        title: Vacancy.title,
        skills: Vacancy.skills,
        salary: Vacancy.salary,
      })
      .from(Vacancy)
      .innerJoin(SearchKeyword, eq(Vacancy.keywordId, SearchKeyword.id))
      .where(
        and(
          eq(SearchKeyword.userId, input.userId),
          eq(Vacancy.categoryId, input.categoryId),
          eq(Vacancy.isArchived, false),
        ),
      );

    const analysis = analyzeMarket(category.label, vacancies);

    let baseResume: string | undefined;
    if (input.baseResumeId) {
      const base = await db.query.Resume.findFirst({
        where: and(
          eq(Resume.id, input.baseResumeId),
          eq(Resume.userId, input.userId),
        ),
        columns: { content: true },
      });
      baseResume = base?.content;
    }

    return {
      categoryLabel: category.label,
      analysis,
      baseResume,
      vacancyCount: analysis.vacancyCount,
    };
  },
});

// ── Шаг 2: генерация и сохранение резюме ────────────────────────────────────
generateResumeWorkflow.task({
  name: "generate-and-save",
  parents: [analyzeMarketStep],
  retries: 1,
  executionTimeout: "5m",
  fn: async (rawInput, ctx) => {
    const input = rawInput as unknown as GenerateResumeJobInput;
    const { categoryLabel, analysis, baseResume, vacancyCount } =
      await ctx.parentOutput(analyzeMarketStep);

    const generated = await generateResume({
      categoryLabel,
      analysis,
      baseResume,
      persona: input.persona,
      creativity: input.creativity ?? "balanced",
      language: input.language,
      modelId: input.modelId,
    });

    const [resume] = await db
      .insert(Resume)
      .values({
        userId: input.userId,
        categoryId: input.categoryId,
        title: generated.title,
        content: generated.content,
        kind: "generated",
        persona: generated.persona,
        model: generated.model,
        sourceVacancyCount: vacancyCount,
      })
      .returning({ id: Resume.id });

    if (!resume) {
      throw new Error("Не удалось сохранить сгенерированное резюме");
    }

    return { resumeId: resume.id, vacancyCount };
  },
});
