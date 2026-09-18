import { paths } from "@job-radar/config";
import { Button } from "@job-radar/ui";
import { IconPlus, IconSparkles } from "@tabler/icons-react";
import Link from "next/link";

import { SiteHeader } from "~/components/layout";
import { ResumeList } from "~/components/resumes/resume-list";
import { api } from "~/orpc/server";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Резюме",
};

export default async function ResumesPage() {
  const { items } = await api.resume.list();

  return (
    <>
      <SiteHeader title="Резюме" />
      <div className="flex flex-1 flex-col gap-4 p-4 md:gap-6 md:p-6">
        {/* Заголовок */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Резюме</h1>
            <p className="text-muted-foreground mt-1 text-sm">
              {items.length > 0
                ? `Сохранено резюме: ${items.length}`
                : "Управляйте своими резюме для откликов на вакансии"}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" asChild>
              <Link href={paths.resumes.generate}>
                <IconSparkles className="size-4" />
                Сгенерировать
              </Link>
            </Button>
            <Button asChild>
              <Link href={paths.resumes.new}>
                <IconPlus className="size-4" />
                Создать
              </Link>
            </Button>
          </div>
        </div>

        {/* Список */}
        <ResumeList items={items} />
      </div>
    </>
  );
}
