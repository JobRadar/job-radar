import { z } from "zod";

export const experienceEnum = z.enum([
  "noExperience",
  "between1And3",
  "between3And6",
  "moreThan6",
]);

export const employmentEnum = z.enum([
  "full",
  "part",
  "project",
  "volunteer",
  "probation",
]);

export const workFormatEnum = z.enum([
  "REMOTE",
  "OFFICE",
  "HYBRID",
  "FIELD_WORK",
]);

/**
 * Валидатор `workFormat` — массив значений, сериализуется в CSV
 * (`"REMOTE,HYBRID"`). Пустой массив или `null` → `null` (фильтр
 * сбрасывается), `undefined` — поле не трогается при обновлении.
 */
export const workFormatField = z
  .array(workFormatEnum)
  .max(4)
  .nullable()
  .optional()
  .transform((v) => {
    if (v === undefined) return undefined;
    if (v === null || v.length === 0) return null;
    return v.join(",");
  });

/** Входные данные формы ключевого слова поиска вакансий. */
export const keywordFormSchema = z.object({
  keyword: z.string().min(1, "Укажите ключевое слово").max(256),
  /** Категория (роль); вакансии наследуют её при скрапинге */
  categoryId: z.string().uuid().nullable().optional(),
  /** Код региона hh.ru: 113 — вся Россия, 1 — Москва, 2 — СПб */
  area: z.number().int().min(0).default(113),
  salaryFrom: z.number().int().positive().optional(),
  salaryTo: z.number().int().positive().optional(),
  experience: experienceEnum.optional(),
  employment: employmentEnum.optional(),
  workFormat: workFormatField,
  isActive: z.boolean().default(true),
});

export type KeywordFormValues = z.infer<typeof keywordFormSchema>;
