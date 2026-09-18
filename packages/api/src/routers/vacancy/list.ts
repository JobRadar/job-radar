import { and, desc, eq, exists, ilike, sql } from "@job-radar/db";
import { SearchKeyword, Vacancy } from "@job-radar/db/schema";
import { z } from "zod";

import { protectedProcedure } from "../../orpc";

/**
 * Возвращает список вакансий текущего пользователя с пагинацией и фильтрацией.
 *
 * Фильтрует по ключевым словам пользователя через коррелированный подзапрос,
 * поэтому пользователь видит только свои вакансии.
 */
export const list = protectedProcedure
  .input(
    z.object({
      limit: z.number().min(1).max(100).default(20),
      offset: z.number().min(0).default(0),
      search: z.string().optional(),
      status: z.enum(["all", "new", "archived"]).default("all"),
    }),
  )
  .handler(async ({ context, input }) => {
    const { db, session } = context;
    const userId = session.user.id;

    // Correlated subquery: vacancy must belong to one of the user's keywords.
    // Using db.select().from() instead of db.query.findMany() so that
    // Vacancy.keywordId inside EXISTS correctly resolves to the outer FROM clause.
    const conditions = [
      exists(
        db
          .select({ one: sql`1` })
          .from(SearchKeyword)
          .where(
            and(
              eq(SearchKeyword.id, Vacancy.keywordId),
              eq(SearchKeyword.userId, userId),
            ),
          ),
      ),
    ];

    if (input.search) {
      conditions.push(ilike(Vacancy.title, `%${input.search}%`));
    }

    if (input.status === "new") {
      conditions.push(eq(Vacancy.isNew, true));
    } else if (input.status === "archived") {
      conditions.push(eq(Vacancy.isArchived, true));
    }

    const whereClause = and(...conditions);

    const [items, countResult] = await Promise.all([
      db
        .select()
        .from(Vacancy)
        .where(whereClause)
        .orderBy(desc(Vacancy.createdAt))
        .limit(input.limit)
        .offset(input.offset),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(Vacancy)
        .where(whereClause),
    ]);

    return {
      items,
      total: countResult[0]?.count ?? 0,
    };
  });
