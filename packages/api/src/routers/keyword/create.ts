import { SearchKeyword } from "@job-radar/db";
import { keywordFormSchema } from "@job-radar/validators";
import { ORPCError } from "@orpc/server";

import { protectedProcedure } from "../../orpc";

/**
 * Создать ключевое слово поиска для текущего пользователя.
 */
export const create = protectedProcedure
  .input(keywordFormSchema)
  .handler(async ({ context, input }) => {
    const { db, session } = context;

    if (!input.keyword && !input.professionalRoles?.length) {
      throw new ORPCError("BAD_REQUEST", {
        message: "Укажите ключевое слово или выберите IT-роли",
      });
    }

    const [row] = await db
      .insert(SearchKeyword)
      .values({
        userId: session.user.id,
        keyword: input.keyword ?? null,
        professionalRoles: input.professionalRoles ?? null,
        categoryId: input.categoryId ?? null,
        area: input.area,
        salaryFrom: input.salaryFrom,
        salaryTo: input.salaryTo,
        experience: input.experience,
        employment: input.employment,
        workFormat: input.workFormat,
        isActive: input.isActive,
      })
      .returning();

    if (!row) {
      throw new ORPCError("INTERNAL_SERVER_ERROR", {
        message: "Не удалось создать ключевое слово",
      });
    }

    return row;
  });
