import { and, eq, SearchKeyword } from "@job-radar/db";
import { ORPCError } from "@orpc/server";
import { z } from "zod";

import { protectedProcedure } from "../../orpc";

/**
 * Удалить ключевое слово — только в рамках текущего пользователя.
 *
 * Внимание: вместе с ключевым словом каскадно удаляются связанные
 * вакансии и истории прогонов скрапинга (onDelete: cascade).
 */
export const deleteKeyword = protectedProcedure
  .input(z.object({ id: z.string().uuid() }))
  .handler(async ({ context, input }) => {
    const { db, session } = context;

    const [deleted] = await db
      .delete(SearchKeyword)
      .where(
        and(
          eq(SearchKeyword.id, input.id),
          eq(SearchKeyword.userId, session.user.id),
        ),
      )
      .returning({ id: SearchKeyword.id });

    if (!deleted) {
      throw new ORPCError("NOT_FOUND", {
        message: "Ключевое слово не найдено",
      });
    }

    return { success: true, id: deleted.id };
  });
