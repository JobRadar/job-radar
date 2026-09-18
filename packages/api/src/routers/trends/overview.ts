import { sql } from "@job-radar/db";

import { protectedProcedure } from "../../orpc";
import { rowsOf } from "./_helpers";

interface OverviewRow {
  total: number;
  new7: number;
  new30: number;
}

interface SkillsRow {
  distinct_skills: number;
}

/**
 * Сводка по спаршенным вакансиям пользователя:
 * всего вакансий, новых за 7/30 дней, число уникальных навыков.
 */
export const overview = protectedProcedure.handler(async ({ context }) => {
  const { db, session } = context;
  const userId = session.user.id;

  const counts = rowsOf<OverviewRow>(
    await db.execute(sql`
      select
        count(*)::int as total,
        count(*) filter (
          where coalesce(v.published_at, v.created_at) >= now() - interval '7 days'
        )::int as new7,
        count(*) filter (
          where coalesce(v.published_at, v.created_at) >= now() - interval '30 days'
        )::int as new30
      from vacancies v
      join search_keywords k on v.keyword_id = k.id
      where k.user_id = ${userId} and v.is_archived = false
    `),
  );

  const skills = rowsOf<SkillsRow>(
    await db.execute(sql`
      select count(distinct s.skill)::int as distinct_skills
      from vacancies v
      join search_keywords k on v.keyword_id = k.id
      cross join lateral jsonb_array_elements_text(
        coalesce(v.skills, '[]'::jsonb)
      ) as s(skill)
      where k.user_id = ${userId} and v.is_archived = false
    `),
  );

  const row = counts[0];
  return {
    totalVacancies: row?.total ?? 0,
    newLast7Days: row?.new7 ?? 0,
    newLast30Days: row?.new30 ?? 0,
    distinctSkills: skills[0]?.distinct_skills ?? 0,
  };
});
