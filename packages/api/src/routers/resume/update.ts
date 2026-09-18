import { and, eq, ne, Resume } from "@job-radar/db";
import { resumeFormSchema } from "@job-radar/validators";
import { ORPCError } from "@orpc/server";
import { z } from "zod";

import { protectedProcedure } from "../../orpc";

/**
 * Обновить резюме — только в рамках текущего пользователя.
 */
export const update = protectedProcedure
  .input(resumeFormSchema.extend({ id: z.string().uuid() }))
  .handler(async ({ context, input }) => {
    const { db, session } = context;
    const userId = session.user.id;

    const [updated] = await db
      .update(Resume)
      .set({
        title: input.title,
        content: input.content,
        isDefault: input.isDefault,
      })
      .where(and(eq(Resume.id, input.id), eq(Resume.userId, userId)))
      .returning();

    if (!updated) {
      throw new ORPCError("NOT_FOUND", { message: "Резюме не найдено" });
    }

    // Если резюме помечено как основное — снимаем флаг с остальных
    if (input.isDefault) {
      await db
        .update(Resume)
        .set({ isDefault: false })
        .where(and(eq(Resume.userId, userId), ne(Resume.id, updated.id)));
    }

    return updated;
  });
