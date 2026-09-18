import { Category, desc, eq, SearchKeyword } from "@job-radar/db";

import { protectedProcedure } from "../../orpc";

/**
 * Список ключевых слов поиска текущего пользователя с названием категории.
 */
export const list = protectedProcedure.handler(async ({ context }) => {
  const { db, session } = context;

  const items = await db
    .select({
      id: SearchKeyword.id,
      keyword: SearchKeyword.keyword,
      professionalRoles: SearchKeyword.professionalRoles,
      categoryId: SearchKeyword.categoryId,
      categoryLabel: Category.label,
      area: SearchKeyword.area,
      salaryFrom: SearchKeyword.salaryFrom,
      salaryTo: SearchKeyword.salaryTo,
      experience: SearchKeyword.experience,
      employment: SearchKeyword.employment,
      workFormat: SearchKeyword.workFormat,
      isActive: SearchKeyword.isActive,
      createdAt: SearchKeyword.createdAt,
    })
    .from(SearchKeyword)
    .leftJoin(Category, eq(SearchKeyword.categoryId, Category.id))
    .where(eq(SearchKeyword.userId, session.user.id))
    .orderBy(desc(SearchKeyword.createdAt));

  return { items };
});
