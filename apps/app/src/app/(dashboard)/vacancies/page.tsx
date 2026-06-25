import { SiteHeader } from "~/components/layout";
import { VacancyFilters } from "~/components/vacancies/vacancy-filters";
import { VacancyTable } from "~/components/vacancies/vacancy-table";
import { api } from "~/orpc/server";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Вакансии",
};

interface VacanciesPageProps {
  searchParams: Promise<{
    search?: string;
    status?: string;
    page?: string;
  }>;
}

export default async function VacanciesPage({
  searchParams,
}: VacanciesPageProps) {
  const params = await searchParams;

  const page = Math.max(1, Number(params.page ?? "1"));
  const limit = 20;
  const offset = (page - 1) * limit;

  // Валидируем статус
  const validStatuses = ["all", "new", "archived"] as const;
  const status = validStatuses.includes(
    params.status as (typeof validStatuses)[number],
  )
    ? (params.status as "all" | "new" | "archived")
    : "all";

  const { items, total } = await api.vacancy.list({
    limit,
    offset,
    search: params.search?.trim() || undefined,
    status,
  });

  const pageCount = Math.ceil(total / limit);

  return (
    <>
      <SiteHeader title="Вакансии" />
      <div className="flex flex-1 flex-col gap-4 p-4 md:gap-6 md:p-6">
        {/* Заголовок */}
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Вакансии</h1>
            <p className="text-muted-foreground mt-1 text-sm">
              {total > 0
                ? `Найдено ${total.toLocaleString("ru-RU")} вакансий с hh.ru`
                : "Вакансии ещё не загружены"}
            </p>
          </div>
        </div>

        {/* Фильтры */}
        <VacancyFilters search={params.search ?? ""} status={status} />

        {/* Таблица */}
        <VacancyTable
          items={items}
          total={total}
          page={page}
          pageCount={pageCount}
          limit={limit}
        />
      </div>
    </>
  );
}
