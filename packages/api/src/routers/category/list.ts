import { asc, Category } from "@job-radar/db";

import { protectedProcedure } from "../../orpc";

/**
 * Справочник категорий (ролей) — для выбора при поиске и генерации резюме.
 */
export const list = protectedProcedure.handler(async ({ context }) => {
  const items = await context.db
    .select()
    .from(Category)
    .orderBy(asc(Category.label));

  return { items };
});
