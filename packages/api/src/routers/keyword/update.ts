import { and, eq, SearchKeyword } from "@job-radar/db";
import { keywordFormSchema } from "@job-radar/validators";
import { ORPCError } from "@orpc/server";
import { z } from "zod";

import { protectedProcedure } from "../../orpc";

/**
 * Обновить ключевое слово — только в рамках текущего пользователя.
 */
export const update = protectedProcedure
  .input(keywordFormSchema.extend({ id: z.string().uuid() }))
  .handler(async ({ context, input }) => {
    const { db, session } = context;

    const [updated] = await db
      .update(SearchKeyword)
      .set({
        keyword: input.keyword,
        categoryId: input.categoryId ?? null,
        area: input.area,
        salaryFrom: input.salaryFrom,
        salaryTo: input.salaryTo,
        experience: input.experience,
        employment: input.employment,
        workFormat: input.workFormat,
        isActive: input.isActive,
      })
      .where(
        and(
          eq(SearchKeyword.id, input.id),
          eq(SearchKeyword.userId, session.user.id),
        ),
      )
      .returning();

    if (!updated) {
      throw new ORPCError("NOT_FOUND", {
        message: "Ключевое слово не найдено",
      });
    }

    return updated;
  });
