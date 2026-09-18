"use client";

import type { VacancyRow } from "@job-radar/db/schema";
import {
  Badge,
  Button,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@job-radar/ui";
import {
  IconBriefcase,
  IconChevronLeft,
  IconChevronRight,
  IconExternalLink,
} from "@tabler/icons-react";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

// ── Вспомогательные функции ─────────────────────────────────────────────────

interface HhSalary {
  from: number | null;
  to: number | null;
  currency: string;
  gross: boolean;
}

function formatSalary(salary: HhSalary | null | undefined): string {
  if (!salary) return "—";
  const parts: string[] = [];
  if (salary.from) parts.push(`от ${salary.from.toLocaleString("ru-RU")}`);
  if (salary.to) parts.push(`до ${salary.to.toLocaleString("ru-RU")}`);
  if (parts.length === 0) return "—";
  return `${parts.join(" ")} ${salary.currency}`;
}

const EXPERIENCE_LABELS: Record<string, string> = {
  noExperience: "Нет опыта",
  between1And3: "1–3 года",
  between3And6: "3–6 лет",
  moreThan6: "Более 6 лет",
};

function formatExperience(exp: string | null | undefined): string {
  if (!exp) return "—";
  return EXPERIENCE_LABELS[exp] ?? exp;
}

// ── Компонент ───────────────────────────────────────────────────────────────

interface VacancyTableProps {
  items: VacancyRow[];
  total: number;
  page: number;
  pageCount: number;
  limit: number;
}

export function VacancyTable({
  items,
  total,
  page,
  pageCount,
  limit,
}: VacancyTableProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function goToPage(newPage: number) {
    const params = new URLSearchParams(searchParams.toString());
    if (newPage === 1) {
      params.delete("page");
    } else {
      params.set("page", String(newPage));
    }
    router.push(`${pathname}?${params.toString()}`);
  }

  const from = total === 0 ? 0 : (page - 1) * limit + 1;
  const to = Math.min(page * limit, total);

  return (
    <div className="flex flex-col gap-4">
      {/* Таблица */}
      <div className="overflow-hidden rounded-lg border">
        <Table>
          <TableHeader className="bg-muted sticky top-0 z-10">
            <TableRow>
              <TableHead className="w-[40%]">Вакансия</TableHead>
              <TableHead>Компания</TableHead>
              <TableHead className="hidden md:table-cell">Зарплата</TableHead>
              <TableHead className="hidden lg:table-cell">Регион</TableHead>
              <TableHead className="hidden lg:table-cell">Опыт</TableHead>
              <TableHead className="hidden xl:table-cell">Дата</TableHead>
              <TableHead className="w-[100px]">Статус</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={7}
                  className="text-muted-foreground h-32 text-center"
                >
                  <div className="flex flex-col items-center gap-2">
                    <IconBriefcase className="size-8 opacity-40" />
                    <span>Вакансии не найдены</span>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              items.map((vacancy) => (
                <TableRow key={vacancy.id}>
                  {/* Название */}
                  <TableCell className="font-medium">
                    <a
                      href={vacancy.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:text-primary inline-flex items-center gap-1.5 transition-colors"
                    >
                      <span className="line-clamp-2">{vacancy.title}</span>
                      <IconExternalLink className="text-muted-foreground size-3.5 shrink-0" />
                    </a>
                  </TableCell>

                  {/* Компания */}
                  <TableCell>
                    <span className="text-muted-foreground text-sm">
                      {vacancy.employerName ?? "—"}
                    </span>
                  </TableCell>

                  {/* Зарплата */}
                  <TableCell className="hidden md:table-cell">
                    <span className="whitespace-nowrap text-sm tabular-nums">
                      {formatSalary(vacancy.salary)}
                    </span>
                  </TableCell>

                  {/* Регион */}
                  <TableCell className="hidden lg:table-cell">
                    <span className="text-muted-foreground text-sm">
                      {vacancy.area ?? "—"}
                    </span>
                  </TableCell>

                  {/* Опыт */}
                  <TableCell className="hidden lg:table-cell">
                    <span className="text-muted-foreground text-sm">
                      {formatExperience(vacancy.experience)}
                    </span>
                  </TableCell>

                  {/* Дата публикации */}
                  <TableCell className="hidden xl:table-cell">
                    <span className="text-muted-foreground text-sm tabular-nums">
                      {vacancy.publishedAt
                        ? format(new Date(vacancy.publishedAt), "d MMM yyyy", {
                            locale: ru,
                          })
                        : "—"}
                    </span>
                  </TableCell>

                  {/* Статус */}
                  <TableCell>
                    {vacancy.isArchived ? (
                      <Badge variant="secondary">Архив</Badge>
                    ) : vacancy.isNew ? (
                      <Badge>Новая</Badge>
                    ) : (
                      <Badge variant="outline">Просмотрена</Badge>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Пагинация */}
      {pageCount > 0 && (
        <div className="flex items-center justify-between px-1">
          <p className="text-muted-foreground text-sm">
            {total === 0
              ? "Нет результатов"
              : `${from}–${to} из ${total.toLocaleString("ru-RU")}`}
          </p>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="icon"
              className="size-8"
              onClick={() => goToPage(page - 1)}
              disabled={page <= 1}
              aria-label="Предыдущая страница"
            >
              <IconChevronLeft className="size-4" />
            </Button>
            <span className="text-sm font-medium tabular-nums px-2">
              {page} / {pageCount}
            </span>
            <Button
              variant="outline"
              size="icon"
              className="size-8"
              onClick={() => goToPage(page + 1)}
              disabled={page >= pageCount}
              aria-label="Следующая страница"
            >
              <IconChevronRight className="size-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
