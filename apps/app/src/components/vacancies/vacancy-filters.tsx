"use client";

import { Input, Tabs, TabsList, TabsTrigger } from "@job-radar/ui";
import { IconSearch } from "@tabler/icons-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

interface VacancyFiltersProps {
  search: string;
  status: "all" | "new" | "archived";
}

export function VacancyFilters({ search, status }: VacancyFiltersProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Локальное состояние поиска с дебаунсом
  const [searchValue, setSearchValue] = useState(search);

  // Читаем searchParams через ref чтобы не включать его в deps эффекта.
  // useSearchParams() возвращает новый объект на каждой навигации,
  // поэтому включение в deps вызывало бесконечный цикл:
  // push → searchParams меняется → эффект → push → ...
  const searchParamsRef = useRef(searchParams);
  searchParamsRef.current = searchParams;

  const isFirstRender = useRef(true);

  useEffect(() => {
    // Пропускаем первый рендер — значение уже в URL
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }

    const timer = setTimeout(() => {
      const params = new URLSearchParams(searchParamsRef.current.toString());
      if (searchValue) {
        params.set("search", searchValue);
      } else {
        params.delete("search");
      }
      // Сбрасываем страницу при новом поиске
      params.delete("page");
      router.push(`${pathname}?${params.toString()}`);
    }, 400);

    return () => clearTimeout(timer);
    // searchParams намеренно исключён из deps — используем ref выше
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchValue, pathname, router]);

  function handleStatusChange(value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value === "all") {
      params.delete("status");
    } else {
      params.set("status", value);
    }
    params.delete("page");
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="relative w-full sm:max-w-sm">
        <IconSearch className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" />
        <Input
          type="search"
          placeholder="Поиск по названию…"
          className="pl-9"
          value={searchValue}
          onChange={(e) => setSearchValue(e.target.value)}
          autoComplete="off"
          spellCheck={false}
        />
      </div>

      <Tabs value={status} onValueChange={handleStatusChange}>
        <TabsList>
          <TabsTrigger value="all">Все</TabsTrigger>
          <TabsTrigger value="new">Новые</TabsTrigger>
          <TabsTrigger value="archived">Архив</TabsTrigger>
        </TabsList>
      </Tabs>
    </div>
  );
}
