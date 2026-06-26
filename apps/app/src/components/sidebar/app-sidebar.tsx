"use client";

import { APP_CONFIG, paths } from "@job-radar/config";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@job-radar/ui";
import {
  IconBriefcase,
  IconChartBar,
  IconDashboard,
  IconFileText,
  IconInnerShadowTop,
  IconSettings,
} from "@tabler/icons-react";
import type * as React from "react";
import { NavMain, NavSecondary, NavUser } from "~/components/sidebar";

const data = {
  navMain: [
    {
      title: "Dashboard",
      url: paths.dashboard.root,
      icon: IconDashboard,
      isActive: true,
      items: [{ title: "Overview", url: paths.dashboard.root }],
    },
    {
      title: "Вакансии",
      url: paths.vacancies.root,
      icon: IconBriefcase,
      items: [
        { title: "Все", url: paths.vacancies.root },
        { title: "Новые", url: `${paths.vacancies.root}?status=new` },
        { title: "Архив", url: `${paths.vacancies.root}?status=archived` },
        { title: "Ключевые слова", url: paths.keywords.root },
      ],
    },
    {
      title: "Резюме",
      url: paths.resumes.root,
      icon: IconFileText,
      items: [
        { title: "Все", url: paths.resumes.root },
        { title: "Создать", url: paths.resumes.new },
        { title: "Сгенерировать", url: paths.resumes.generate },
      ],
    },
    {
      title: "Тренды",
      url: paths.trends.root,
      icon: IconChartBar,
      items: [{ title: "Рынок", url: paths.trends.root }],
    },
  ],
  navSecondary: [
    {
      title: "Settings",
      url: paths.settings.root,
      icon: IconSettings,
    },
  ],
};

export function AppSidebar({
  user,
  ...props
}: React.ComponentProps<typeof Sidebar> & {
  user: {
    name: string;
    email: string;
    avatar: string;
  };
}) {
  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <a href={paths.dashboard.root}>
                <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                  <IconInnerShadowTop className="size-4" />
                </div>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-semibold">
                    {APP_CONFIG.name}
                  </span>
                </div>
              </a>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={data.navMain} />
        <NavSecondary items={data.navSecondary} className="mt-auto" />
      </SidebarContent>
      <SidebarFooter>
        <NavUser user={user} />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
