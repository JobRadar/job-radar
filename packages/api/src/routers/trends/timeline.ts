import { sql } from "@job-radar/db";
import { z } from "zod";

import { protectedProcedure } from "../../orpc";
import { rowsOf } from "./_helpers";

export interface TimelineRow {
  week: string;
  count: number;
}

/**
 * Динамика появления вакансий по неделям за последние `weeks` недель.
 * Показывает рост/спад активности рынка во времени.
 */
export const timeline = protectedProcedure
  .input(
    z.object({
      categoryId: z.string().uuid().optional(),
      weeks: z.number().int().min(2).max(52).default(12),
    }),
  )
  .handler(async ({ context, input }) => {
    const { db, session } = context;
    const userId = session.user.id;
    const days = input.weeks * 7;

    const categoryFilter = input.categoryId
      ? sql`and v.category_id = ${input.categoryId}`
      : sql``;

    const items = rowsOf<TimelineRow>(
      await db.execute(sql`
        select
          to_char(
            date_trunc('week', coalesce(v.published_at, v.created_at)),
            'YYYY-MM-DD'
          ) as week,
          count(*)::int as count
        from vacancies v
        join search_keywords k on v.keyword_id = k.id
        where k.user_id = ${userId}
          and v.is_archived = false
          and coalesce(v.published_at, v.created_at) >= now() - make_interval(days => ${days})
          ${categoryFilter}
        group by week
        order by week asc
      `),
    );

    return { items };
  });
