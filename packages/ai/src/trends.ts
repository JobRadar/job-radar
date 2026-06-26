import { generateObject } from "ai";
import { z } from "zod";

import { defaultModelId, getModel } from "./client";

/** Zod-схема структурированного резюме трендов рынка. */
export const TrendInsightSchema = z.object({
  summary: z
    .string()
    .max(1200)
    .describe("Связное резюме трендов рынка на русском языке (2–4 абзаца)"),
  inDemandSkills: z
    .array(z.string())
    .describe("Самые востребованные навыки прямо сейчас"),
  emergingSkills: z
    .array(z.string())
    .describe("Растущие/новые навыки, набирающие спрос"),
  inDemandRoles: z
    .array(z.string())
    .describe("Наиболее востребованные роли/специалисты"),
  recommendations: z
    .array(z.string())
    .describe("Рекомендации соискателю: что подтянуть, на что делать ставку"),
});

export type TrendInsight = z.infer<typeof TrendInsightSchema>;

export interface TrendsInput {
  /** Всего проанализировано вакансий */
  totalVacancies: number;
  /** Топ навыков по частоте: [{ skill, count }] */
  topSkills: { skill: string; count: number }[];
  /** Растущие навыки: дельта спроса recent vs previous */
  risingSkills: { skill: string; recent: number; previous: number }[];
  /** Спрос по ролям/категориям */
  demandByCategory: { label: string; total: number; recent: number }[];
}

/**
 * Сформировать связное резюме трендов рынка на основе агрегатов вакансий.
 *
 * Считает не сам LLM — он лишь интерпретирует уже посчитанную статистику
 * (частота навыков, рост спроса, распределение по ролям) в текст и
 * рекомендации. Цифры остаются детерминированными.
 *
 * @throws если LLM недоступен или ключ не задан
 */
export async function summarizeTrends(
  input: TrendsInput & { modelId?: string },
): Promise<TrendInsight & { model: string }> {
  const modelId = input.modelId ?? defaultModelId;

  const topSkillsLine = input.topSkills
    .map((s) => `${s.skill}: ${s.count}`)
    .join("; ");
  const risingLine = input.risingSkills
    .map((s) => `${s.skill}: ${s.previous}→${s.recent}`)
    .join("; ");
  const rolesLine = input.demandByCategory
    .map((c) => `${c.label}: ${c.total} (за 30 дней: ${c.recent})`)
    .join("; ");

  const prompt = [
    "Ты — аналитик рынка труда в IT. На основе агрегированной статистики вакансий",
    "опиши текущие тренды: какие навыки и специалисты востребованы, что растёт.",
    "Опирайся ТОЛЬКО на приведённые цифры, не выдумывай новых фактов.",
    "",
    `Всего вакансий: ${input.totalVacancies}`,
    `Топ навыков (навык: число вакансий): ${topSkillsLine || "нет данных"}`,
    `Динамика навыков (навык: было→стало): ${risingLine || "нет данных"}`,
    `Спрос по ролям: ${rolesLine || "нет данных"}`,
  ].join("\n");

  const { object } = await generateObject({
    model: getModel(modelId),
    schema: TrendInsightSchema,
    prompt,
  });

  return { ...object, model: modelId };
}
