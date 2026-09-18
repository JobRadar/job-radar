import { and, eq, Resume } from "@job-radar/db";
import { ORPCError } from "@orpc/server";
import { z } from "zod";

import { protectedProcedure } from "../../orpc";

/**
 * Удалить резюме — только в рамках текущего пользователя.
 */
export const deleteResume = protectedProcedure
  .input(z.object({ id: z.string().uuid() }))
  .handler(async ({ context, input }) => {
    const { db, session } = context;

    const [deleted] = await db
      .delete(Resume)
      .where(and(eq(Resume.id, input.id), eq(Resume.userId, session.user.id)))
      .returning({ id: Resume.id });

    if (!deleted) {
      throw new ORPCError("NOT_FOUND", { message: "Резюме не найдено" });
    }

    return { success: true, id: deleted.id };
  });
