import { desc, eq, Resume } from "@job-radar/db";

import { protectedProcedure } from "../../orpc";

/**
 * Список резюме текущего пользователя.
 * Основное резюме (isDefault) идёт первым, далее — по дате создания.
 */
export const list = protectedProcedure.handler(async ({ context }) => {
  const { db, session } = context;

  const items = await db
    .select()
    .from(Resume)
    .where(eq(Resume.userId, session.user.id))
    .orderBy(desc(Resume.isDefault), desc(Resume.createdAt));

  return { items };
});
