import { z } from "zod";

/** Степень творчества при генерации резюме. */
export const creativitySchema = z.enum(["grounded", "balanced", "inventive"]);

/** Персона сгенерированного резюме (имя/возраст/опыт/локация). */
export const resumePersonaSchema = z.object({
  fullName: z.string().max(128).optional(),
  age: z.number().int().min(14).max(99).optional(),
  yearsOfExperience: z.number().int().min(0).max(60).optional(),
  location: z.string().max(128).optional(),
});

/** Входные данные формы генерации резюме под категорию. */
export const resumeGenerateSchema = z.object({
  categoryId: z.string().uuid(),
  /** Базовое резюме — источник реального профиля (опционально) */
  baseResumeId: z.string().uuid().optional(),
  creativity: creativitySchema.default("balanced"),
  persona: resumePersonaSchema.optional(),
  language: z.string().max(32).optional(),
});

export type ResumeGenerateValues = z.infer<typeof resumeGenerateSchema>;
export type ResumePersonaValues = z.infer<typeof resumePersonaSchema>;
