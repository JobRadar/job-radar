import { and, desc, eq } from "@job-radar/db";
import { SearchKeyword } from "@job-radar/db/schema";
import { ORPCError } from "@orpc/server";
import { z } from "zod";

import { protectedProcedure } from "../../orpc";

/**
 * «Последние 20 вакансий» — это одна страница выдачи hh.ru (20 вакансий/стр).
 */
const LATEST_PAGE_COUNT = 1;

/**
 * Запустить скрапинг последних 20 вакансий hh.ru.
 *
 * Скрапинг привязан к ключевому слову поиска, поэтому берём самое свежее
 * активное ключевое слово пользователя и запускаем прогон на одну страницу
 * выдачи (≈20 вакансий). Реальная работа выполняется в worker-процессе
 * Hatchet — здесь мы лишь ставим прогон в очередь.
 */
export const scrape = protectedProcedure
  .input(
    z
      .object({
        /** Опционально: запустить скрапинг конкретного ключевого слова. */
        keywordId: z.string().uuid().optional(),
      })
      .optional(),
  )
  .handler(async ({ context, input }) => {
    const { db, session } = context;
    const userId = session.user.id;

    // Находим ключевое слово: либо указанное, либо самое свежее активное.
    const keyword = await db.query.SearchKeyword.findFirst({
      where: input?.keywordId
        ? and(
            eq(SearchKeyword.id, input.keywordId),
            eq(SearchKeyword.userId, userId),
          )
        : and(
            eq(SearchKeyword.userId, userId),
            eq(SearchKeyword.isActive, true),
          ),
      orderBy: desc(SearchKeyword.createdAt),
      columns: { id: true, keyword: true, isActive: true },
    });

    if (!keyword) {
      throw new ORPCError("BAD_REQUEST", {
        message:
          "Нет активного ключевого слова для поиска. Добавьте ключевое слово и повторите запуск.",
      });
    }

    if (!keyword.isActive) {
      throw new ORPCError("BAD_REQUEST", {
        message:
          "Ключевое слово неактивно. Активируйте его и повторите запуск.",
      });
    }

    // Лениво подгружаем триггер: модуль обращается к Hatchet gRPC и не должен
    // попадать в основной бандл Next.js.
    const { triggerScrapeHh } = await import("@job-radar/jobs/triggers");

    let workflowRunId: string;
    try {
      workflowRunId = await triggerScrapeHh({
        keywordId: keyword.id,
        maxPages: LATEST_PAGE_COUNT,
      });
    } catch (_err) {
      throw new ORPCError("INTERNAL_SERVER_ERROR", {
        message:
          "Не удалось запустить скрапинг. Проверьте, что worker (Hatchet) запущен.",
      });
    }

    return {
      workflowRunId,
      keyword: keyword.keyword,
    };
  });
