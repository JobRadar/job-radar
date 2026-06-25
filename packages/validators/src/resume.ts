import { z } from "zod";

export const resumeFormSchema = z.object({
  title: z.string().min(1, "Укажите название резюме").max(256),
  content: z.string().max(50_000),
  isDefault: z.boolean(),
});

export type ResumeFormValues = z.infer<typeof resumeFormSchema>;
