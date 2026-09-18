import { summarizeTrends } from "@job-radar/ai";
import { sql } from "@job-radar/db";
import { ORPCError } from "@orpc/server";
import { z } from "zod";

import { protectedProcedure } from "../../orpc";
import { rowsOf } from "./_helpers";

interface SkillRow {
  skill: string;
  count: number;
}
interface RisingRow {
  skill: string;
  recent: number;
  previous: number;
}
interface DemandRow {
  label: string;
  total: number;
  recent: number;
}
interface TotalRow {
  total: number;
}

/**
 * LLM-резюме трендов рынка: собирает агрегаты (топ навыков, рост спроса,
 * спрос по ролям) и просит модель связно их описать с рекомендациями.
 *
 * Цифры считаются детерминированно в SQL; LLM только интерпретирует их.
 */
export const insights = protectedProcedure
  .input(
    z
      .object({ days: z.number().int().min(7).max(180).default(30) })
      .default({ days: 30 }),
  )
  .handler(async ({ context, input }) => {
    const { db, session } = context;
    const userId = session.user.id;
    const prevDays = input.days * 2;

    const [totalRows, topRows, risingRows, demandRows] = await Promise.all([
      db
        .execute(
          sql`
            select count(*)::int as total
            from vacancies v
            join search_keywords k on v.keyword_id = k.id
            where k.user_id = ${userId} and v.is_archived = false
          `,
        )
        .then((r) => rowsOf<TotalRow>(r)),
      db
        .execute(
          sql`
            select s.skill as skill, count(*)::int as count
            from vacancies v
            join search_keywords k on v.keyword_id = k.id
            cross join lateral jsonb_array_elements_text(
              coalesce(v.skills, '[]'::jsonb)
            ) as s(skill)
            where k.user_id = ${userId} and v.is_archived = false
            group by s.skill
            order by count desc
            limit 25
          `,
        )
        .then((r) => rowsOf<SkillRow>(r)),
      db
        .execute(
          sql`
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
              coalesce(p.c, 0) as previous
            from recent r
            full outer join previous p on r.skill = p.skill
            where coalesce(r.c, 0) - coalesce(p.c, 0) > 0
            order by coalesce(r.c, 0) - coalesce(p.c, 0) desc
            limit 15
          `,
        )
        .then((r) => rowsOf<RisingRow>(r)),
      db
        .execute(
          sql`
            select
              coalesce(c.label, 'Без категории') as label,
              count(*)::int as total,
              count(*) filter (
                where coalesce(v.published_at, v.created_at) >= now() - interval '30 days'
              )::int as recent
            from vacancies v
            join search_keywords k on v.keyword_id = k.id
            left join categories c on v.category_id = c.id
            where k.user_id = ${userId} and v.is_archived = false
            group by c.label
            order by total desc
          `,
        )
        .then((r) => rowsOf<DemandRow>(r)),
    ]);

    const totalVacancies = totalRows[0]?.total ?? 0;
    if (totalVacancies === 0) {
      throw new ORPCError("BAD_REQUEST", {
        message: "Нет вакансий для анализа — сначала запустите скрапинг",
      });
    }

    try {
      const result = await summarizeTrends({
        totalVacancies,
        topSkills: topRows,
        risingSkills: risingRows,
        demandByCategory: demandRows,
      });
      return result;
    } catch (err) {
      throw new ORPCError("INTERNAL_SERVER_ERROR", {
        message: `Ошибка LLM при анализе трендов: ${
          err instanceof Error ? err.message : String(err)
        }`,
      });
    }
  });
