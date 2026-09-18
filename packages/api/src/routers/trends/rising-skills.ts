import { sql } from "@job-radar/db";
import { z } from "zod";

import { protectedProcedure } from "../../orpc";
import { rowsOf } from "./_helpers";

export interface RisingRow {
  skill: string;
  recent: number;
  previous: number;
  delta: number;
}

/**
 * Растущие навыки: сравнивает спрос за последнее окно (`days`) с предыдущим
 * окном такой же длины и сортирует по приросту. Показывает, что набирает
 * популярность на рынке.
 */
export const risingSkills = protectedProcedure
  .input(
    z.object({
      days: z.number().int().min(7).max(180).default(30),
      limit: z.number().int().min(1).max(50).default(15),
    }),
  )
  .handler(async ({ context, input }) => {
    const { db, session } = context;
    const userId = session.user.id;
    const prevDays = input.days * 2;

    const items = rowsOf<RisingRow>(
      await db.execute(sql`
        with recent as (
          select s.skill, count(*)::int as c
          from vacancies v
          join search_keywords k on v.keyword_id = k.id
          cross join lateral jsonb_array_elements_text(
            coalesce(v.skills, '[]'::jsonb)
          ) as s(skill)
          where k.user_id = ${userId} and v.is_archived = false
            and coalesce(v.published_at, v.created_at) >= now() - make_interval(days => ${input.days})
          group by s.skill
        ),
        previous as (
          select s.skill, count(*)::int as c
          from vacancies v
          join search_keywords k on v.keyword_id = k.id
          cross join lateral jsonb_array_elements_text(
            coalesce(v.skills, '[]'::jsonb)
          ) as s(skill)
          where k.user_id = ${userId} and v.is_archived = false
            and coalesce(v.published_at, v.created_at) >= now() - make_interval(days => ${prevDays})
            and coalesce(v.published_at, v.created_at) <  now() - make_interval(days => ${input.days})
          group by s.skill
        )
        select
          coalesce(r.skill, p.skill) as skill,
          coalesce(r.c, 0) as recent,
          coalesce(p.c, 0) as previous,
          coalesce(r.c, 0) - coalesce(p.c, 0) as delta
        from recent r
        full outer join previous p on r.skill = p.skill
        where coalesce(r.c, 0) - coalesce(p.c, 0) > 0
        order by delta desc, recent desc
        limit ${input.limit}
      `),
    );

    return { items };
  });
