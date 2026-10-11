import {
  createOpenAICompatible,
  type OpenAICompatibleProvider,
} from "@ai-sdk/openai-compatible";
import { env } from "@job-radar/config";
import type { LanguageModel } from "ai";

let cachedProvider: OpenAICompatibleProvider | null = null;

/**
 * Ленивая инициализация OpenAI-совместимого провайдера для Vercel AI SDK
 * (router.cheap, OpenRouter и т.п. — задаётся `AI_BASE_URL`).
 *
 * Ключ берётся из env (`AI_API_KEY`). Провайдер кэшируется,
 * чтобы не пересоздавать клиента на каждый вызов.
 *
 * @throws если `AI_API_KEY` не задан
 */
export function getProvider(): OpenAICompatibleProvider {
  if (cachedProvider) return cachedProvider;

  const apiKey = env.AI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "AI_API_KEY не задан. Укажите ключ LLM-шлюза в .env, чтобы использовать LLM-функции.",
    );
  }

  cachedProvider = createOpenAICompatible({
    name: "llm",
    apiKey,
    baseURL: env.AI_BASE_URL,
  });

  return cachedProvider;
}

/**
 * Возвращает языковую модель по идентификатору.
 *
 * @param modelId напр. "gemini-3.8-flash"; по умолчанию — `AI_MODEL`
 */
export function getModel(modelId: string = env.AI_MODEL): LanguageModel {
  return getProvider().chatModel(modelId);
}

/** Модель LLM по умолчанию (из env). */
export const defaultModelId = env.AI_MODEL;

/** Модель для скоринга резюме↔вакансия: `AI_SCORE_MODEL`, иначе `AI_MODEL`. */
export const scoreModelId = env.AI_SCORE_MODEL || env.AI_MODEL;
