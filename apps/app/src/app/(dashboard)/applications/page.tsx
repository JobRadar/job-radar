import { paths } from "@job-radar/config";
import { redirect } from "next/navigation";

import { ApplicationList } from "~/components/applications/application-list";
import { SiteHeader } from "~/components/layout";
import { api } from "~/orpc/server";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Отклики",
};

const STATUSES = ["todo", "applied", "skipped"] as const;
const PAGE_SIZE = 50;
type Status = (typeof STATUSES)[number];

interface ApplicationsPageProps {
  searchParams: Promise<{ status?: string; page?: string }>;
}

/**
 * Загрузить до 50 задач выбранного статуса и счётчики для страницы откликов.
 * Если статус отсутствует или некорректен, показать задачи «К отклику».
 */
export default async function ApplicationsPage({
  searchParams,
}: ApplicationsPageProps) {
  const params = await searchParams;
  const status: Status = STATUSES.includes(params.status as Status)
    ? (params.status as Status)
    : "todo";

  const requestedPage = Number(params.page ?? 1);
  // Keep offsets within PostgreSQL's integer range, including for malformed URLs.
  const page =
    Number.isSafeInteger(requestedPage) &&
    requestedPage > 0 &&
    (requestedPage - 1) * PAGE_SIZE <= 2_147_483_647
      ? requestedPage
      : 1;
  const { items, counts, total } = await api.application.list({
    status,
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  });
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // A status change can remove the last item on the current page.
  if (page > totalPages) {
    redirect(`${paths.applications.root}?status=${status}&page=${totalPages}`);
  }

  return (
    <>
      <SiteHeader title="Отклики" />
      <div className="flex flex-1 flex-col gap-4 p-4 md:gap-6 md:p-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Отклики</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Вакансии, подобранные под ваше резюме, с готовым сопроводительным
            письмом. Скопируйте письмо, откликнитесь на hh.ru и отметьте задачу.
          </p>
        </div>

        <ApplicationList
          status={status}
          counts={counts}
          items={items}
          total={total}
          page={page}
          totalPages={totalPages}
        />
      </div>
    </>
  );
}
