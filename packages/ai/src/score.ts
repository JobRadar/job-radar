import { generateObject } from "ai";

import { defaultModelId, getModel } from "./client";
import {
  type MatchScore,
  MatchScoreSchema,
  type VacancyForScoring,
} from "./types";

const SYSTEM_PROMPT = `Ты — опытный IT-рекрутер. Тебе дают текст резюме кандидата и описание вакансии.
Оцени, насколько резюме соответствует вакансии, по шкале 0–100, где:
- 0–39 — слабое соответствие,
- 40–69 — частичное соответствие,
- 70–89 — хорошее соответствие,
- 90–100 — отличное соответствие.
Опирайся на навыки, опыт, стек технологий и требования.
Будь объективен и строг. Все текстовые поля — на русском языке.`;

export interface ScoreResult extends MatchScore {
  /** Идентификатор использованной модели */
  model: string;
}

/**
 * Оценить соответствие резюме конкретной вакансии через LLM.
 *
 * Возвращает структурированный результат: очки 0–100, обоснование,
 * совпавшие/недостающие навыки, плюсы и минусы.
 *
 * @throws если LLM недоступен или ключ не задан
 */
export async function scoreResumeVacancy(params: {
  resumeContent: string;
  vacancy: VacancyForScoring;
  modelId?: string;
}): Promise<ScoreResult> {
  const modelId = params.modelId ?? defaultModelId;

  const skillsLine =
    params.vacancy.skills.length > 0
      ? params.vacancy.skills.join(", ")
      : "не указаны";

  const prompt = [
    "## Резюме кандидата",
    params.resumeContent.trim() || "(пусто)",
    "",
    "## Вакансия",
    `Должность: ${params.vacancy.title}`,
    params.vacancy.employerName
      ? `Компания: ${params.vacancy.employerName}`
      : "",
    params.vacancy.experience
      ? `Требуемый опыт: ${params.vacancy.experience}`
      : "",
    `Ключевые навыки: ${skillsLine}`,
    "",
    "Описание:",
    (params.vacancy.description ?? "").trim().slice(0, 6000) ||
      "(нет описания)",
  ]
    .filter(Boolean)
    .join("\n");

  const { object } = await generateObject({
    model: getModel(modelId),
    schema: MatchScoreSchema,
    system: SYSTEM_PROMPT,
    prompt,
  });

  return { ...object, model: modelId };
}
