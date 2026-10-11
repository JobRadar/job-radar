import { and, ApplicationTask, eq } from "@job-radar/db";
import { ORPCError } from "@orpc/server";
import { z } from "zod";

import { protectedProcedure } from "../../orpc";

/**
 * Сменить статус задачи: «откликнулся», «пропустить» или вернуть в работу.
 * Работает только с задачами текущего пользователя.
 */
export const setStatus = protectedProcedure
  .input(
    z.object({
      id: z.string().uuid(),
      status: z.enum(["todo", "applied", "skipped"]),
    }),
  )
  .handler(async ({ context, input }) => {
    const { db, session } = context;

    const [updated] = await db
      .update(ApplicationTask)
      .set({
        status: input.status,
        appliedAt: input.status === "applied" ? new Date() : null,
      })
      .where(
        and(
          eq(ApplicationTask.id, input.id),
          eq(ApplicationTask.userId, session.user.id),
        ),
      )
      .returning({ id: ApplicationTask.id, status: ApplicationTask.status });

    if (!updated) {
      throw new ORPCError("NOT_FOUND", { message: "Задача не найдена" });
    }

    return updated;
  });
