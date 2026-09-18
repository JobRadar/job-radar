import { generateObject } from "ai";

import { defaultModelId, getModel } from "./client";
import {
  type GeneratedResume,
  GeneratedResumeSchema,
  type GenerateResumeInput,
} from "./types";

const CREATIVITY_INSTRUCTION: Record<
  GenerateResumeInput["creativity"],
  string
> = {
  grounded:
    "Опирайся СТРОГО на базовое резюме. Не выдумывай опыт, проекты и навыки, которых там нет. Можно только переформулировать и расставить акценты под рынок.",
  balanced:
    "Опирайся на базовое резюме, но усиливай формулировки и подчёркивай релевантные рынку навыки. Допустимы умеренные обобщения, без явных выдумок.",
  inventive:
    "Можно сочинять правдоподобный опыт, проекты и навыки под требования рынка, даже если их нет в базовом резюме. Сделай резюме максимально подходящим под большинство вакансий категории. Соблюдай внутреннюю непротиворечивость (стаж, возраст, проекты).",
};

const SYSTEM_PROMPT = `Ты — эксперт по составлению IT-резюме под рынок труда.
Твоя задача — собрать сильное, цельное резюме под конкретную роль на основе анализа реальных вакансий.
Резюме должно покрывать максимум востребованных навыков категории и проходить ATS-фильтры.
Структура (Markdown): заголовок-должность, краткое «О себе», ключевые навыки, опыт работы (с проектами и результатами), образование.
Все тексты — на указанном языке. Возвращай заполненное поле persona, согласованное с содержанием.`;

/**
 * Сгенерировать резюме под категорию на основе анализа рынка вакансий.
 *
 * В зависимости от `creativity` либо строго опирается на базовое резюме,
 * либо может выдумывать опыт/персону (включая возраст) под требования рынка.
 *
 * @throws если LLM недоступен или ключ не задан
 */
export async function generateResume(
  input: GenerateResumeInput & { modelId?: string },
): Promise<GeneratedResume & { model: string }> {
  const modelId = input.modelId ?? defaultModelId;
  const language = input.language ?? "русский";

  const topSkills = input.analysis.topSkills
    .map((s) => `${s.skill} (${s.count})`)
    .join(", ");

  const personaLines: string[] = [];
  if (input.persona?.fullName)
    personaLines.push(`Имя: ${input.persona.fullName}`);
  if (typeof input.persona?.age === "number")
    personaLines.push(`Возраст: ${input.persona.age}`);
  if (typeof input.persona?.yearsOfExperience === "number")
    personaLines.push(`Лет опыта: ${input.persona.yearsOfExperience}`);
  if (input.persona?.location)
    personaLines.push(`Локация: ${input.persona.location}`);

  const prompt = [
    `## Роль / категория\n${input.categoryLabel}`,
    "",
    "## Анализ рынка вакансий",
    `Проанализировано вакансий: ${input.analysis.vacancyCount}`,
    `Востребованные навыки (по частоте): ${topSkills || "нет данных"}`,
    input.analysis.commonTitles.length > 0
      ? `Типичные должности: ${input.analysis.commonTitles.join(", ")}`
      : "",
    input.analysis.salaryHint ? `Зарплата: ${input.analysis.salaryHint}` : "",
    "",
    "## Базовое резюме (реальный профиль)",
    input.baseResume?.trim() || "(не предоставлено)",
    "",
    "## Целевая персона",
    personaLines.length > 0 ? personaLines.join("\n") : "(на твоё усмотрение)",
    "",
    "## Инструкции",
    `Язык резюме: ${language}.`,
    CREATIVITY_INSTRUCTION[input.creativity],
  ]
    .filter(Boolean)
    .join("\n");

  const { object } = await generateObject({
    model: getModel(modelId),
    schema: GeneratedResumeSchema,
    system: SYSTEM_PROMPT,
    prompt,
  });

  return { ...object, model: modelId };
}
