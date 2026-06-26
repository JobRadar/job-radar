import { sql } from "@job-radar/db";
import { z } from "zod";

import { protectedProcedure } from "../../orpc";
import { rowsOf } from "./_helpers";

export interface SkillRow {
  skill: string;
  count: number;
}

/**
 * Топ востребованных навыков по частоте упоминания в вакансиях.
 * Можно ограничить категорией и временным окном (в днях).
 */
export const topSkills = protectedProcedure
  .input(
    z.object({
      categoryId: z.string().uuid().optional(),
      days: z.number().int().min(1).max(365).optional(),
      limit: z.number().int().min(1).max(100).default(30),
    }),
  )
  .handler(async ({ context, input }) => {
    const { db, session } = context;
    const userId = session.user.id;

    const categoryFilter = input.categoryId
      ? sql`and v.category_id = ${input.categoryId}`
      : sql``;
    const dateFilter = input.days
      ? sql`and coalesce(v.published_at, v.created_at) >= now() - make_interval(days => ${input.days})`
      : sql``;

    const items = rowsOf<SkillRow>(
      await db.execute(sql`
        select s.skill as skill, count(*)::int as count
        from vacancies v
        join search_keywords k on v.keyword_id = k.id
        cross join lateral jsonb_array_elements_text(
          coalesce(v.skills, '[]'::jsonb)
        ) as s(skill)
        where k.user_id = ${userId}
          and v.is_archived = false
          ${categoryFilter}
          ${dateFilter}
        group by s.skill
        order by count desc, s.skill asc
        limit ${input.limit}
      `),
    );

    return { items };
  });
