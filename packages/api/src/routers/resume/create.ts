import { and, eq, ne, Resume } from "@job-radar/db";
import { resumeFormSchema } from "@job-radar/validators";
import { ORPCError } from "@orpc/server";

import { protectedProcedure } from "../../orpc";

/**
 * Создать новое резюме для текущего пользователя.
 */
export const create = protectedProcedure
  .input(resumeFormSchema)
  .handler(async ({ context, input }) => {
    const { db, session } = context;
    const userId = session.user.id;

    const [resume] = await db
      .insert(Resume)
      .values({
        userId,
        title: input.title,
        content: input.content,
        isDefault: input.isDefault,
      })
      .returning();

    if (!resume) {
      throw new ORPCError("INTERNAL_SERVER_ERROR", {
        message: "Не удалось создать резюме",
      });
    }

    // Если резюме помечено как основное — снимаем флаг с остальных
    if (input.isDefault) {
      await db
        .update(Resume)
        .set({ isDefault: false })
        .where(and(eq(Resume.userId, userId), ne(Resume.id, resume.id)));
    }

    return resume;
  });
