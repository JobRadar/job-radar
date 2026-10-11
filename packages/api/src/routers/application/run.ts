import { and, desc, eq, or, Resume } from "@job-radar/db";
import { ORPCError } from "@orpc/server";

import { protectedProcedure } from "../../orpc";

/**
 * Запустить подбор вакансий и подготовку откликов прямо сейчас.
 *
 * Реальная работа (скоринг и письма через LLM) выполняется в worker-процессе
 * Hatchet — здесь мы лишь ставим прогон в очередь.
 */
export const run = protectedProcedure.handler(async ({ context }) => {
  const { db, session } = context;
  const userId = session.user.id;

  // Тот же выбор резюме, что и в воркфлоу: основное, иначе свежее базовое.
  const resume = await db.query.Resume.findFirst({
    where: and(
      eq(Resume.userId, userId),
      or(eq(Resume.isDefault, true), eq(Resume.kind, "base")),
    ),
    orderBy: [desc(Resume.isDefault), desc(Resume.createdAt)],
    columns: { id: true, title: true },
  });

  if (!resume) {
    throw new ORPCError("BAD_REQUEST", {
      message: "Сначала создайте резюме — под него подбираются вакансии.",
    });
  }

  // Лениво подгружаем триггер: модуль обращается к Hatchet gRPC и не должен
  // попадать в основной бандл Next.js.
  const { triggerFindApplications } = await import("@job-radar/jobs/triggers");

  let workflowRunId: string;
  try {
    workflowRunId = await triggerFindApplications({
      userId,
      resumeId: resume.id,
    });
  } catch (_err) {
    throw new ORPCError("INTERNAL_SERVER_ERROR", {
      message:
        "Не удалось запустить подбор. Проверьте, что worker (Hatchet) запущен.",
    });
  }

  return { workflowRunId, resumeTitle: resume.title };
});
