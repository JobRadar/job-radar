import { and, eq, Resume } from "@job-radar/db";
import { ORPCError } from "@orpc/server";
import { z } from "zod";

import { protectedProcedure } from "../../orpc";

/**
 * Получить одно резюме по id — только в рамках текущего пользователя.
 */
export const byId = protectedProcedure
  .input(z.object({ id: z.string().uuid() }))
  .handler(async ({ context, input }) => {
    const { db, session } = context;

    const [resume] = await db
      .select()
      .from(Resume)
      .where(and(eq(Resume.id, input.id), eq(Resume.userId, session.user.id)))
      .limit(1);

    if (!resume) {
      throw new ORPCError("NOT_FOUND", { message: "Резюме не найдено" });
    }

    return resume;
  });
