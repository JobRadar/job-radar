"use client";

import {
  SidebarGroup,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  toast,
} from "@job-radar/ui";
import { IconLoader2, IconRadar2 } from "@tabler/icons-react";
import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useORPC } from "~/orpc/react";

/**
 * Кнопка запуска скрапинга последних 20 вакансий hh.ru.
 *
 * Триггерит прогон по самому свежему активному ключевому слову пользователя.
 * Реальная работа идёт в фоне (Hatchet worker), поэтому после постановки в
 * очередь обновляем данные страницы, чтобы подтянуть результаты.
 */
export function ScrapeButton() {
  const orpc = useORPC();
  const router = useRouter();

  const scrapeMutation = useMutation(
    orpc.vacancy.scrape.mutationOptions({
      onSuccess: (data) => {
        toast.success("Скрапинг запущен", {
          description: `Ищем последние 20 вакансий по запросу «${data.keyword}». Результаты появятся через пару минут.`,
        });
        // Подтягиваем свежие данные на текущей странице
        router.refresh();
      },
      onError: (error) => {
        toast.error("Не удалось запустить скрапинг", {
          description: error.message,
        });
      },
    }),
  );

  const isPending = scrapeMutation.isPending;

  return (
    <SidebarGroup>
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton
            tooltip="Скрапинг последних 20 вакансий"
            onClick={() => scrapeMutation.mutate({})}
            disabled={isPending}
            aria-busy={isPending}
            aria-label="Запустить скрапинг последних 20 вакансий"
            className="bg-sidebar-primary text-sidebar-primary-foreground hover:bg-sidebar-primary/90 hover:text-sidebar-primary-foreground active:bg-sidebar-primary/90 active:text-sidebar-primary-foreground"
          >
            {isPending ? (
              <IconLoader2 className="animate-spin" aria-hidden="true" />
            ) : (
              <IconRadar2 aria-hidden="true" />
            )}
            <span>{isPending ? "Запуск…" : "Скрапить 20 вакансий"}</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarGroup>
  );
}
