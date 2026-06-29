"use client";

import type { CategoryRow } from "@job-radar/db/schema";
import {
  Badge,
  Button,
  Checkbox,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  toast,
} from "@job-radar/ui";
import { IconPlus, IconSearch, IconTrash } from "@tabler/icons-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { orpc } from "~/orpc/react";

const NO_CATEGORY = "none";

const EXPERIENCE_LABELS: Record<string, string> = {
  noExperience: "Нет опыта",
  between1And3: "1–3 года",
  between3And6: "3–6 лет",
  moreThan6: "Более 6 лет",
};

const WORK_FORMAT_LABELS: Record<string, string> = {
  REMOTE: "Удалённо",
  OFFICE: "Офис",
  HYBRID: "Гибрид",
  FIELD_WORK: "Разъездная",
};

const ALL_WORK_FORMATS = ["REMOTE", "OFFICE", "HYBRID", "FIELD_WORK"] as const;

/** Разбираем CSV из БД в массив. */
function parseWorkFormat(raw: string | null): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
}

export interface KeywordItem {
  id: string;
  keyword: string;
  categoryId: string | null;
  categoryLabel: string | null;
  area: number;
  salaryFrom: number | null;
  salaryTo: number | null;
  experience: string | null;
  employment: string | null;
  workFormat: string | null;
  isActive: boolean;
  createdAt: Date;
}

interface KeywordManagerProps {
  items: KeywordItem[];
  categories: CategoryRow[];
}

export function KeywordManager({ items, categories }: KeywordManagerProps) {
  const router = useRouter();
  const queryClient = useQueryClient();

  const [keyword, setKeyword] = useState("");
  const [categoryId, setCategoryId] = useState<string>(NO_CATEGORY);
  const [area, setArea] = useState("113");
  const [experience, setExperience] = useState<string>("any");
  // Создание по умолчанию ищет удалёнку — самый частый сценарий
  const [workFormat, setWorkFormat] =
    useState<typeof ALL_WORK_FORMATS[number][]>(["REMOTE"]);

  async function invalidate() {
    await queryClient.invalidateQueries({ queryKey: orpc.keyword.key() });
    router.refresh();
  }

  const createMutation = useMutation({
    ...orpc.keyword.create.mutationOptions(),
    onSuccess: async () => {
      toast.success("Ключевое слово добавлено");
      setKeyword("");
      setCategoryId(NO_CATEGORY);
      setArea("113");
      setExperience("any");
      setWorkFormat(["REMOTE"]);
      await invalidate();
    },
    onError: (err: Error) =>
      toast.error(err.message || "Не удалось добавить ключевое слово"),
  });

  const updateMutation = useMutation({
    ...orpc.keyword.update.mutationOptions(),
    onSuccess: async () => {
      toast.success("Изменения сохранены");
      await invalidate();
    },
    onError: (err: Error) =>
      toast.error(err.message || "Не удалось сохранить изменения"),
  });

  const deleteMutation = useMutation({
    ...orpc.keyword.delete.mutationOptions(),
    onSuccess: async () => {
      toast.success("Ключевое слово удалено");
      await invalidate();
    },
    onError: (err: Error) => toast.error(err.message || "Не удалось удалить"),
  });

  function toggleWorkFormatCreate(value: typeof ALL_WORK_FORMATS[number]) {
    setWorkFormat((curr) =>
      curr.includes(value) ? curr.filter((v) => v !== value) : [...curr, value],
    );
  }

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!keyword.trim()) {
      toast.error("Укажите ключевое слово");
      return;
    }
    createMutation.mutate({
      keyword: keyword.trim(),
      categoryId: categoryId === NO_CATEGORY ? null : categoryId,
      area: Number(area) || 113,
      experience:
        experience === "any"
          ? undefined
          : (experience as KeywordItem["experience"] as never),
      workFormat: workFormat.length > 0 ? (workFormat as never) : null,
      isActive: true,
    });
  }

  function buildUpdatePayload(row: KeywordItem) {
    return {
      id: row.id,
      keyword: row.keyword,
      categoryId: row.categoryId,
      area: row.area,
      salaryFrom: row.salaryFrom ?? undefined,
      salaryTo: row.salaryTo ?? undefined,
      experience: (row.experience ?? undefined) as never,
      employment: (row.employment ?? undefined) as never,
      isActive: row.isActive,
    };
  }

  function changeCategory(row: KeywordItem, value: string) {
    updateMutation.mutate({
      ...buildUpdatePayload(row),
      categoryId: value === NO_CATEGORY ? null : value,
    });
  }

  function toggleActive(row: KeywordItem, next: boolean) {
    updateMutation.mutate({ ...buildUpdatePayload(row), isActive: next });
  }

  function toggleWorkFormat(
    row: KeywordItem,
    value: (typeof ALL_WORK_FORMATS)[number],
  ) {
    const current = parseWorkFormat(row.workFormat);
    const next = current.includes(value)
      ? current.filter((v) => v !== value)
      : [...current, value];
    updateMutation.mutate({
      ...buildUpdatePayload(row),
      workFormat: next.length > 0 ? (next as never) : null,
    });
  }

  function handleDelete(row: KeywordItem) {
    const confirmed = window.confirm(
      `Удалить «${row.keyword}»? Вместе с ним удалятся связанные вакансии. Действие необратимо.`,
    );
    if (confirmed) deleteMutation.mutate({ id: row.id });
  }

  const isMutating =
    createMutation.isPending ||
    updateMutation.isPending ||
    deleteMutation.isPending;

  return (
    <div className="flex flex-col gap-6">
      {/* Форма добавления */}
      <form
        onSubmit={handleCreate}
        className="grid gap-4 rounded-lg border p-4 sm:grid-cols-2 lg:grid-cols-5 lg:items-end"
      >
        <div className="space-y-2 lg:col-span-2">
          <Label htmlFor="keyword">Ключевое слово</Label>
          <Input
            id="keyword"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="Например, AI Engineer…"
            autoComplete="off"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="kw-category">Категория</Label>
          <Select value={categoryId} onValueChange={setCategoryId}>
            <SelectTrigger id="kw-category" className="w-full">
              <SelectValue placeholder="Без категории" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_CATEGORY}>Без категории</SelectItem>
              {categories.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="kw-experience">Опыт</Label>
          <Select value={experience} onValueChange={setExperience}>
            <SelectTrigger id="kw-experience" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="any">Любой</SelectItem>
              {Object.entries(EXPERIENCE_LABELS).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="kw-area">Регион (код hh.ru)</Label>
          <div className="flex gap-2">
            <Input
              id="kw-area"
              type="number"
              inputMode="numeric"
              value={area}
              onChange={(e) => setArea(e.target.value)}
              placeholder="113"
            />
            <Button type="submit" disabled={createMutation.isPending}>
              <IconPlus className="size-4" />
              {createMutation.isPending ? "…" : "Добавить"}
            </Button>
          </div>
        </div>
        <div className="space-y-2 sm:col-span-2 lg:col-span-5">
          <Label>Формат работы</Label>
          <div className="flex flex-wrap gap-2">
            {ALL_WORK_FORMATS.map((fmt) => {
              const checked = workFormat.includes(fmt);
              return (
                <label
                  key={fmt}
                  className="flex cursor-pointer items-center gap-2 rounded-md border px-3 py-1.5 text-sm"
                >
                  <Checkbox
                    checked={checked}
                    onCheckedChange={() => toggleWorkFormatCreate(fmt)}
                  />
                  <span>{WORK_FORMAT_LABELS[fmt]}</span>
                </label>
              );
            })}
          </div>
          <p className="text-muted-foreground text-xs">
            Пусто — без фильтра. Несколько значений объединяются через «или».
          </p>
        </div>
      </form>

      {/* Список */}
      <div className="overflow-hidden rounded-lg border">
        <Table>
          <TableHeader className="bg-muted sticky top-0 z-10">
            <TableRow>
              <TableHead className="w-[30%]">Ключевое слово</TableHead>
              <TableHead className="w-[220px]">Категория</TableHead>
              <TableHead className="hidden md:table-cell">Опыт</TableHead>
              <TableHead>Формат работы</TableHead>
              <TableHead className="w-[120px]">Активно</TableHead>
              <TableHead className="w-[60px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="text-muted-foreground h-32 text-center"
                >
                  <div className="flex flex-col items-center gap-2">
                    <IconSearch className="size-8 opacity-40" />
                    <span>Ключевых слов пока нет</span>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              items.map((row) => {
                const formats = parseWorkFormat(row.workFormat);
                return (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium">{row.keyword}</TableCell>
                    <TableCell>
                      <Select
                        value={row.categoryId ?? NO_CATEGORY}
                        onValueChange={(v) => changeCategory(row, v)}
                        disabled={isMutating}
                      >
                        <SelectTrigger className="w-full" size="sm">
                          <SelectValue placeholder="Без категории" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={NO_CATEGORY}>
                            Без категории
                          </SelectItem>
                          {categories.map((c) => (
                            <SelectItem key={c.id} value={c.id}>
                              {c.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      <span className="text-muted-foreground text-sm">
                        {row.experience
                          ? (EXPERIENCE_LABELS[row.experience] ?? row.experience)
                          : "—"}
                      </span>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {ALL_WORK_FORMATS.map((fmt) => {
                          const active = formats.includes(fmt);
                          return (
                            <button
                              key={fmt}
                              type="button"
                              onClick={() => toggleWorkFormat(row, fmt)}
                              disabled={isMutating}
                              className="focus-visible:ring-ring rounded-full focus-visible:ring-2 focus-visible:outline-none disabled:opacity-50"
                              aria-label={`${WORK_FORMAT_LABELS[fmt]} для ${row.keyword}`}
                            >
                              <Badge
                                variant={active ? "default" : "outline"}
                                className="cursor-pointer"
                              >
                                {WORK_FORMAT_LABELS[fmt]}
                              </Badge>
                            </button>
                          );
                        })}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2 text-sm">
                        <Checkbox
                          checked={row.isActive}
                          onCheckedChange={(c) => toggleActive(row, c === true)}
                          disabled={isMutating}
                          aria-label={`Активность ${row.keyword}`}
                        />
                        {row.isActive ? (
                          <Badge variant="outline">Вкл</Badge>
                        ) : (
                          <Badge variant="secondary">Выкл</Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-muted-foreground hover:text-destructive size-8"
                        onClick={() => handleDelete(row)}
                        disabled={isMutating}
                        aria-label={`Удалить ${row.keyword}`}
                      >
                        <IconTrash className="size-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
