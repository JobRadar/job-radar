import { SiteHeader } from "~/components/layout";
import { ApplicationList } from "~/components/applications/application-list";
import { api } from "~/orpc/server";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Отклики",
};

const STATUSES = ["todo", "applied", "skipped"] as const;
type Status = (typeof STATUSES)[number];

interface ApplicationsPageProps {
  searchParams: Promise<{ status?: string }>;
}

export default async function ApplicationsPage({
  searchParams,
}: ApplicationsPageProps) {
  const params = await searchParams;
  const status: Status = STATUSES.includes(params.status as Status)
    ? (params.status as Status)
    : "todo";

  const { items, counts } = await api.application.list({ status, limit: 50 });

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

        <ApplicationList status={status} counts={counts} items={items} />
      </div>
    </>
  );
}
