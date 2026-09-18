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
import { IT_PROFESSIONAL_ROLES } from "@job-radar/validators";
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

/** Человекочитаемая метка строки: keyword или число выбранных IT-ролей. */
function rowLabel(row: Pick<KeywordItem, "keyword" | "professionalRoles">) {
  return (
    row.keyword ??
    (row.professionalRoles?.length
      ? `IT-роли (${row.professionalRoles.length})`
      : "—")
  );
}

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
  keyword: string | null;
  professionalRoles: string[] | null;
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

/** Управляет созданием и редактированием поисковых запросов вакансий. */
export function KeywordManager({ items, categories }: KeywordManagerProps) {
  const router = useRouter();
  const queryClient = useQueryClient();

  const [keyword, setKeyword] = useState("");
  const [professionalRoles, setProfessionalRoles] = useState<string[]>([]);
  const [categoryId, setCategoryId] = useState<string>(NO_CATEGORY);
  const [area, setArea] = useState("113");
  const [experience, setExperience] = useState<string>("any");
  // Создание по умолчанию ищет удалёнку — самый частый сценарий
  const [workFormat, setWorkFormat] = useState<
    (typeof ALL_WORK_FORMATS)[number][]
  >(["REMOTE"]);

  /** Обновляет кэш запросов и серверные данные страницы. */
  async function invalidate() {
    await queryClient.invalidateQueries({ queryKey: orpc.keyword.key() });
    router.refresh();
  }

  const createMutation = useMutation({
    ...orpc.keyword.create.mutationOptions(),
    onSuccess: async () => {
      toast.success("Ключевое слово добавлено");
      setKeyword("");
      setProfessionalRoles([]);
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

  /** Переключает формат работы в форме создания запроса. */
  function toggleWorkFormatCreate(value: (typeof ALL_WORK_FORMATS)[number]) {
    setWorkFormat((curr) =>
      curr.includes(value) ? curr.filter((v) => v !== value) : [...curr, value],
    );
  }

  /** Добавляет или удаляет IT-роль в форме создания запроса. */
  function toggleProfessionalRole(id: string) {
    setProfessionalRoles((curr) =>
      curr.includes(id) ? curr.filter((v) => v !== id) : [...curr, id],
    );
  }

  /** Проверяет и отправляет форму создания поискового запроса. */
  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!keyword.trim() && professionalRoles.length === 0) {
      toast.error("Укажите ключевое слово или выберите IT-роли");
      return;
    }
    createMutation.mutate({
      keyword: keyword.trim() || undefined,
      professionalRoles:
        professionalRoles.length > 0 ? professionalRoles : undefined,
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

  /** Собирает общие поля запроса для последующего обновления. */
  function buildUpdatePayload(row: KeywordItem) {
    return {
      id: row.id,
      keyword: row.keyword ?? undefined,
      professionalRoles: row.professionalRoles ?? undefined,
      categoryId: row.categoryId,
      area: row.area,
      salaryFrom: row.salaryFrom ?? undefined,
      salaryTo: row.salaryTo ?? undefined,
      experience: (row.experience ?? undefined) as never,
      employment: (row.employment ?? undefined) as never,
      isActive: row.isActive,
    };
  }

  /** Обновляет категорию сохранённого поискового запроса. */
  function changeCategory(row: KeywordItem, value: string) {
    updateMutation.mutate({
      ...buildUpdatePayload(row),
      categoryId: value === NO_CATEGORY ? null : value,
    });
  }

  /** Включает или отключает сохранённый поисковый запрос. */
  function toggleActive(row: KeywordItem, next: boolean) {
    updateMutation.mutate({ ...buildUpdatePayload(row), isActive: next });
  }

  /** Переключает формат работы в сохранённом поисковом запросе. */
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

  /** Подтверждает и удаляет сохранённый поисковый запрос. */
  function handleDelete(row: KeywordItem) {
    const confirmed = window.confirm(
      `Удалить «${rowLabel(row)}»? Вместе с ним удалятся связанные вакансии. Действие необратимо.`,
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
            placeholder="Необязательно, если выбраны IT-роли ниже"
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
        <div className="space-y-2 sm:col-span-2 lg:col-span-5">
          <div className="flex items-center justify-between">
            <Label>IT-роли hh.ru (вместо/вместе с ключевым словом)</Label>
            <div className="flex gap-2">
              <button
                type="button"
                className="text-primary text-xs underline-offset-2 hover:underline"
                onClick={() =>
                  setProfessionalRoles(IT_PROFESSIONAL_ROLES.map((r) => r.id))
                }
              >
                Выбрать все ({IT_PROFESSIONAL_ROLES.length})
              </button>
              <button
                type="button"
                className="text-muted-foreground text-xs underline-offset-2 hover:underline"
                onClick={() => setProfessionalRoles([])}
              >
                Снять всё
              </button>
            </div>
          </div>
          <div className="flex max-h-40 flex-wrap gap-2 overflow-y-auto rounded-md border p-2">
            {IT_PROFESSIONAL_ROLES.map((role) => {
              const checked = professionalRoles.includes(role.id);
              return (
                <label
                  key={role.id}
                  className="flex cursor-pointer items-center gap-2 rounded-md border px-2 py-1 text-xs"
                >
                  <Checkbox
                    checked={checked}
                    onCheckedChange={() => toggleProfessionalRole(role.id)}
                  />
                  <span>{role.name}</span>
                </label>
              );
            })}
          </div>
          <p className="text-muted-foreground text-xs">
            Например: «Выбрать все» — покроет все вакансии IT-сферы hh.ru без
            текстового запроса.
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
                    <TableCell className="font-medium">
                      {rowLabel(row)}
                    </TableCell>
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
                          ? (EXPERIENCE_LABELS[row.experience] ??
                            row.experience)
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
                              aria-label={`${WORK_FORMAT_LABELS[fmt]} для ${rowLabel(row)}`}
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
                          aria-label={`Активность ${rowLabel(row)}`}
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
                        aria-label={`Удалить ${rowLabel(row)}`}
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
