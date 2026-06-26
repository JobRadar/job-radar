import { analyzeMarket, generateResume } from "@job-radar/ai";
import {
  and,
  Category,
  eq,
  Resume,
  SearchKeyword,
  Vacancy,
} from "@job-radar/db";
import { resumeGenerateSchema } from "@job-radar/validators";
import { ORPCError } from "@orpc/server";

import { protectedProcedure } from "../../orpc";

/**
 * Сгенерировать резюме под категорию на основе спарсенных вакансий (LLM).
 *
 * Анализирует рынок (частота навыков, зарплаты) и составляет резюме,
 * опираясь на базовое резюме и/или выдумывая профиль — в зависимости от
 * выбранного уровня creativity. Сохраняет как резюме типа `generated`.
 */
export const generate = protectedProcedure
  .input(resumeGenerateSchema)
  .handler(async ({ context, input }) => {
    const { db, session } = context;
    const userId = session.user.id;

    const category = await db.query.Category.findFirst({
      where: eq(Category.id, input.categoryId),
    });
    if (!category) {
      throw new ORPCError("NOT_FOUND", { message: "Категория не найдена" });
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
          eq(SearchKeyword.userId, userId),
          eq(Vacancy.categoryId, input.categoryId),
          eq(Vacancy.isArchived, false),
        ),
      );

    if (vacancies.length === 0) {
      throw new ORPCError("BAD_REQUEST", {
        message:
          "Нет спарсенных вакансий этой категории — сначала запустите поиск вакансий",
      });
    }

    const analysis = analyzeMarket(category.label, vacancies);

    let baseResume: string | undefined;
    if (input.baseResumeId) {
      const base = await db.query.Resume.findFirst({
        where: and(
          eq(Resume.id, input.baseResumeId),
          eq(Resume.userId, userId),
        ),
        columns: { content: true },
      });
      baseResume = base?.content;
    }

    let generated: Awaited<ReturnType<typeof generateResume>>;
    try {
      generated = await generateResume({
        categoryLabel: category.label,
        analysis,
        baseResume,
        persona: input.persona,
        creativity: input.creativity,
        language: input.language,
      });
    } catch (err) {
      throw new ORPCError("INTERNAL_SERVER_ERROR", {
        message: `Ошибка LLM при генерации: ${
          err instanceof Error ? err.message : String(err)
        }`,
      });
    }

    const [resume] = await db
      .insert(Resume)
      .values({
        userId,
        categoryId: input.categoryId,
        title: generated.title,
        content: generated.content,
        kind: "generated",
        persona: generated.persona,
        model: generated.model,
        sourceVacancyCount: analysis.vacancyCount,
      })
      .returning();

    if (!resume) {
      throw new ORPCError("INTERNAL_SERVER_ERROR", {
        message: "Не удалось сохранить сгенерированное резюме",
      });
    }

    return resume;
  });
