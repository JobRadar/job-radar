import { z } from "zod";

/**
 * Персона резюме (для генерации вариаций под разный профиль).
 * Совместима с `ResumePersona` из @job-radar/db.
 */
export interface Persona {
  fullName?: string;
  age?: number;
  yearsOfExperience?: number;
  location?: string;
}

/**
 * Агрегированный анализ рынка по категории — вход для генерации резюме.
 * Считается детерминированно из спарсенных вакансий (частота навыков и т.п.).
 */
export interface MarketAnalysis {
  /** Человекочитаемое название роли */
  categoryLabel: string;
  /** Сколько вакансий легло в основу анализа */
  vacancyCount: number;
  /** Топ навыков по частоте упоминания */
  topSkills: { skill: string; count: number }[];
  /** Типичные заголовки вакансий */
  commonTitles: string[];
  /** Подсказка по зарплатной вилке (текст) */
  salaryHint?: string;
}

/**
 * Степень «творчества» при генерации резюме:
 *  grounded  — строго на основе базового резюме, без выдумок
 *  balanced  — на основе базового, с разумным усилением формулировок
 *  inventive — допускается выдумывать опыт/проекты под рынок
 */
export const Creativity = ["grounded", "balanced", "inventive"] as const;
export type CreativityLevel = (typeof Creativity)[number];

// ── Скоринг соответствия ────────────────────────────────────────────────────

/** Zod-схема структурированного ответа LLM при оценке соответствия. */
export const MatchScoreSchema = z.object({
  score: z
    .number()
    .min(0)
    .max(100)
    .describe("Очки соответствия резюме вакансии от 0 до 100"),
  summary: z
    .string()
    .max(600)
    .describe("Краткое обоснование оценки на русском языке"),
  matchedSkills: z
    .array(z.string())
    .describe("Навыки из вакансии, которые покрыты резюме"),
  missingSkills: z
    .array(z.string())
    .describe("Навыки из вакансии, которых не хватает в резюме"),
  pros: z.array(z.string()).describe("Сильные стороны кандидата под вакансию"),
  cons: z.array(z.string()).describe("Слабые стороны и риски"),
});

export type MatchScore = z.infer<typeof MatchScoreSchema>;

/** Данные вакансии, необходимые для оценки. */
export interface VacancyForScoring {
  title: string;
  skills: string[];
  description?: string | null;
  experience?: string | null;
  employerName?: string | null;
}

// ── Генерация резюме ─────────────────────────────────────────────────────────

/** Zod-схема структурированного ответа LLM при генерации резюме. */
export const GeneratedResumeSchema = z.object({
  title: z
    .string()
    .max(256)
    .describe("Заголовок резюме (должность под категорию)"),
  content: z
    .string()
    .describe(
      "Полный текст резюме в Markdown: о себе, опыт, навыки, проекты, образование",
    ),
  persona: z
    .object({
      fullName: z.string().optional(),
      age: z.number().int().optional(),
      yearsOfExperience: z.number().int().optional(),
      location: z.string().optional(),
    })
    .describe("Использованная персона кандидата"),
});

export type GeneratedResume = z.infer<typeof GeneratedResumeSchema>;

export interface GenerateResumeInput {
  /** Человекочитаемое название категории/роли */
  categoryLabel: string;
  /** Анализ рынка по категории */
  analysis: MarketAnalysis;
  /** Базовое резюме пользователя (реальный профиль), если есть */
  baseResume?: string;
  /** Целевая персона (имя/возраст/опыт/локация) */
  persona?: Persona;
  /** Степень творчества/выдумки */
  creativity: CreativityLevel;
  /** Язык резюме (по умолчанию «русский») */
  language?: string;
}
