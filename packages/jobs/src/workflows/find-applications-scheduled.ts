import { eq } from "@job-radar/db";
import { db } from "@job-radar/db/client";
import { SearchKeyword } from "@job-radar/db/schema";
import { hatchet } from "../client";
import { findApplicationsWorkflow } from "./find-applications";

/**
 * Cron-workflow: по расписанию подбирает вакансии под резюме и создаёт
 * задачи на отклик для каждого пользователя с активными ключевыми словами.
 *
 * По умолчанию запускается в :30 каждые 6 часов — через полчаса после
 * скрапинга (`scrape-hh-scheduled`), чтобы подхватить свежие вакансии.
 * Расписание меняется через переменную FIND_APPLICATIONS_CRON.
 *
 * @see https://docs.hatchet.run/home/triggers#cron-triggers
 */
export const findApplicationsScheduledWorkflow = hatchet.workflow({
  name: "find-applications-scheduled",
  on: {
    cron: process.env.FIND_APPLICATIONS_CRON ?? "30 */6 * * *",
  },
});

findApplicationsScheduledWorkflow.task({
  name: "dispatch-user-runs",
  retries: 1,
  executionTimeout: "2m",
  fn: async () => {
    const users = await db
      .selectDistinct({ userId: SearchKeyword.userId })
      .from(SearchKeyword)
      .where(eq(SearchKeyword.isActive, true));

    if (users.length === 0) {
      return {
        dispatched: 0,
        failed: 0,
        message: "Нет пользователей с активными ключевыми словами",
      };
    }

    // Отдельный прогон на пользователя (без ожидания результата): ошибка у
    // одного, например отсутствие резюме, не должна ронять остальных.
    const results = await Promise.allSettled(
      users.map((u) =>
        findApplicationsWorkflow.runNoWait({ userId: u.userId }),
      ),
    );

    return {
      dispatched: results.filter((r) => r.status === "fulfilled").length,
      failed: results.filter((r) => r.status === "rejected").length,
    };
  },
});
