import { sql } from "@job-radar/db";

import { protectedProcedure } from "../../orpc";
import { rowsOf } from "./_helpers";

export interface DemandRow {
  category_id: string | null;
  label: string;
  total: number;
  recent: number;
}

/**
 * Спрос по ролям/категориям: сколько вакансий в каждой категории и
 * сколько появилось за последние 30 дней. Отвечает на вопрос
 * «какие специалисты сейчас нужны».
 */
export const demandByCategory = protectedProcedure.handler(
  async ({ context }) => {
    const { db, session } = context;
    const userId = session.user.id;

    const items = rowsOf<DemandRow>(
      await db.execute(sql`
        select
          c.id as category_id,
          coalesce(c.label, 'Без категории') as label,
          count(*)::int as total,
          count(*) filter (
            where coalesce(v.published_at, v.created_at) >= now() - interval '30 days'
          )::int as recent
        from vacancies v
        join search_keywords k on v.keyword_id = k.id
        left join categories c on v.category_id = c.id
        where k.user_id = ${userId} and v.is_archived = false
        group by c.id, c.label
        order by total desc
      `),
    );

    return { items };
  },
);
