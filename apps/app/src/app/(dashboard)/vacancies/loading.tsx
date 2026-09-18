import { Skeleton } from "@job-radar/ui";
import { SiteHeader } from "~/components/layout";

export default function VacanciesLoading() {
  return (
    <>
      <SiteHeader title="Вакансии" />
      <div className="flex flex-1 flex-col gap-4 p-4 md:gap-6 md:p-6">
        {/* Заголовок */}
        <div className="space-y-2">
          <Skeleton className="h-8 w-36" />
          <Skeleton className="h-4 w-56" />
        </div>

        {/* Фильтры */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <Skeleton className="h-9 w-full sm:max-w-sm" />
          <Skeleton className="h-9 w-52" />
        </div>

        {/* Таблица */}
        <div className="overflow-hidden rounded-lg border">
          {/* Заголовок таблицы */}
          <div className="bg-muted flex gap-4 px-4 py-3">
            <Skeleton className="h-4 flex-[2]" />
            <Skeleton className="h-4 flex-1" />
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 w-20" />
          </div>
          {/* Строки */}
          {Array.from({ length: 10 }, (_, i) => `skeleton-row-${i}`).map(
            (key) => (
              <div
                key={key}
                className="flex items-center gap-4 border-t px-4 py-3.5"
              >
                <Skeleton className="h-4 flex-[2]" />
                <Skeleton className="h-4 flex-1" />
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-5 w-16 rounded-full" />
              </div>
            ),
          )}
        </div>
      </div>
    </>
  );
}
