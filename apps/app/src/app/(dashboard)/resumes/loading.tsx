import { Skeleton } from "@job-radar/ui";

import { SiteHeader } from "~/components/layout";

export default function ResumesLoading() {
  return (
    <>
      <SiteHeader title="Резюме" />
      <div className="flex flex-1 flex-col gap-4 p-4 md:gap-6 md:p-6">
        {/* Заголовок */}
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-2">
            <Skeleton className="h-8 w-36" />
            <Skeleton className="h-4 w-56" />
          </div>
          <Skeleton className="h-9 w-28" />
        </div>

        {/* Карточки */}
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {["a", "b", "c", "d", "e", "f"].map((key) => (
            <div key={key} className="space-y-4 rounded-xl border p-6">
              <Skeleton className="h-5 w-2/3" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-1/2" />
              <div className="flex items-center justify-between pt-2">
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-8 w-24" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
