"use client";

import { paths } from "@job-radar/config";
import type { CategoryRow, ResumeRow } from "@job-radar/db/schema";
import {
  Button,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  toast,
} from "@job-radar/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { orpc } from "~/orpc/react";

type CreativityLevel = "grounded" | "balanced" | "inventive";

const CREATIVITY_OPTIONS: {
  value: CreativityLevel;
  label: string;
  hint: string;
}[] = [
  {
    value: "grounded",
    label: "Строго по фактам",
    hint: "Только на основе базового резюме, без выдумок",
  },
  {
    value: "balanced",
    label: "Сбалансированно",
    hint: "Усиление формулировок под рынок, без явных выдумок",
  },
  {
    value: "inventive",
    label: "Творчески",
    hint: "Можно сочинять опыт и проекты под требования рынка",
  },
];

interface ResumeGenerateFormProps {
  categories: CategoryRow[];
  baseResumes: ResumeRow[];
}

export function ResumeGenerateForm({
  categories,
  baseResumes,
}: ResumeGenerateFormProps) {
  const router = useRouter();
  const queryClient = useQueryClient();

  const [categoryId, setCategoryId] = useState<string>("");
  const [creativity, setCreativity] = useState<CreativityLevel>("balanced");
  const [baseResumeId, setBaseResumeId] = useState<string>("");
  const [fullName, setFullName] = useState("");
  const [age, setAge] = useState("");
  const [years, setYears] = useState("");
  const [location, setLocation] = useState("");

  const generateMutation = useMutation({
    ...orpc.resume.generate.mutationOptions(),
    onSuccess: async (resume: ResumeRow) => {
      toast.success("Резюме сгенерировано");
      await queryClient.invalidateQueries({ queryKey: orpc.resume.key() });
      router.push(paths.resumes.byId(resume.id));
      router.refresh();
    },
    onError: (err: Error) => {
      toast.error(err.message || "Не удалось сгенерировать резюме");
    },
  });

  const selectedCreativity = CREATIVITY_OPTIONS.find(
    (o) => o.value === creativity,
  );

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!categoryId) {
      toast.error("Выберите категорию");
      return;
    }

    const persona: Record<string, string | number> = {};
    if (fullName.trim()) persona.fullName = fullName.trim();
    if (age.trim()) persona.age = Number(age);
    if (years.trim()) persona.yearsOfExperience = Number(years);
    if (location.trim()) persona.location = location.trim();

    generateMutation.mutate({
      categoryId,
      creativity,
      baseResumeId: baseResumeId || undefined,
      persona: Object.keys(persona).length > 0 ? persona : undefined,
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Категория */}
      <div className="space-y-2">
        <Label htmlFor="category">Категория (роль)</Label>
        <Select value={categoryId} onValueChange={setCategoryId}>
          <SelectTrigger id="category" className="w-full">
            <SelectValue placeholder="Выберите роль…" />
          </SelectTrigger>
          <SelectContent>
            {categories.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-muted-foreground text-sm">
          Резюме соберётся на основе спарсенных вакансий этой категории.
        </p>
      </div>

      {/* Степень творчества */}
      <div className="space-y-2">
        <Label htmlFor="creativity">Режим генерации</Label>
        <Select
          value={creativity}
          onValueChange={(v) => setCreativity(v as CreativityLevel)}
        >
          <SelectTrigger id="creativity" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CREATIVITY_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {selectedCreativity && (
          <p className="text-muted-foreground text-sm">
            {selectedCreativity.hint}
          </p>
        )}
      </div>

      {/* Базовое резюме */}
      <div className="space-y-2">
        <Label htmlFor="baseResume">Базовое резюме (необязательно)</Label>
        <Select
          value={baseResumeId}
          onValueChange={(v) => setBaseResumeId(v === "none" ? "" : v)}
        >
          <SelectTrigger id="baseResume" className="w-full">
            <SelectValue placeholder="Без основы — сгенерировать с нуля" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">Без основы</SelectItem>
            {baseResumes.map((r) => (
              <SelectItem key={r.id} value={r.id}>
                {r.title}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-muted-foreground text-sm">
          Реальный профиль как источник правды для генерации.
        </p>
      </div>

      {/* Персона */}
      <fieldset className="space-y-4 rounded-lg border p-4">
        <legend className="px-1 text-sm font-medium">
          Персона (необязательно)
        </legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="fullName">Имя</Label>
            <Input
              id="fullName"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Иван Иванов"
              autoComplete="off"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="location">Локация</Label>
            <Input
              id="location"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="Москва"
              autoComplete="off"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="age">Возраст</Label>
            <Input
              id="age"
              type="number"
              inputMode="numeric"
              min={14}
              max={99}
              value={age}
              onChange={(e) => setAge(e.target.value)}
              placeholder="30"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="years">Лет опыта</Label>
            <Input
              id="years"
              type="number"
              inputMode="numeric"
              min={0}
              max={60}
              value={years}
              onChange={(e) => setYears(e.target.value)}
              placeholder="5"
            />
          </div>
        </div>
      </fieldset>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={generateMutation.isPending}>
          {generateMutation.isPending
            ? "Генерация… это может занять до минуты"
            : "Сгенерировать резюме"}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={generateMutation.isPending}
          onClick={() => router.push(paths.resumes.root)}
        >
          Отмена
        </Button>
      </div>
    </form>
  );
}
