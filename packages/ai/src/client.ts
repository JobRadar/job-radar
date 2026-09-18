import { env } from "@job-radar/config";
import {
  createOpenRouter,
  type OpenRouterProvider,
} from "@openrouter/ai-sdk-provider";
import type { LanguageModel } from "ai";

let cachedProvider: OpenRouterProvider | null = null;

/**
 * Ленивая инициализация OpenRouter-провайдера для Vercel AI SDK.
 *
 * Ключ берётся из env (`OPENROUTER_API_KEY`). Провайдер кэшируется,
 * чтобы не пересоздавать клиента на каждый вызов.
 *
 * @throws если `OPENROUTER_API_KEY` не задан
 */
export function getOpenRouter(): OpenRouterProvider {
  if (cachedProvider) return cachedProvider;

  const apiKey = env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error(
      "OPENROUTER_API_KEY не задан. Укажите ключ OpenRouter в .env, чтобы использовать LLM-функции.",
    );
  }

  cachedProvider = createOpenRouter({
    apiKey,
    baseURL: env.OPENROUTER_BASE_URL,
  });

  return cachedProvider;
}

/**
 * Возвращает языковую модель OpenRouter по идентификатору.
 *
 * @param modelId напр. "openai/gpt-4o-mini"; по умолчанию — `OPENROUTER_MODEL`
 */
export function getModel(
  modelId: string = env.OPENROUTER_MODEL,
): LanguageModel {
  return getOpenRouter().chat(modelId);
}

/** Модель LLM по умолчанию (из env). */
export const defaultModelId = env.OPENROUTER_MODEL;
