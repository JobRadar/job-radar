"use client";

import {
  Badge,
  Button,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  toast,
} from "@job-radar/ui";
import {
  IconExternalLink,
  IconSparkles,
  IconTargetArrow,
} from "@tabler/icons-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";

import { orpc } from "~/orpc/react";

export interface MatchItem {
  id: string;
  vacancyId: string;
  score: number;
  summary: string | null;
  status: "pending" | "scored" | "failed";
  vacancyTitle: string;
  employerName: string | null;
  vacancyUrl: string;
}

interface ResumeMatchesProps {
  resumeId: string;
  hasCategory: boolean;
  items: MatchItem[];
  total: number;
}

/** Бейдж очков: цвет по диапазону + обязательно число (не только цвет). */
function ScoreBadge({
  score,
  status,
}: {
  score: number;
  status: MatchItem["status"];
}) {
  if (status === "pending") {
    return <Badge variant="outline">В очереди</Badge>;
  }
  if (status === "failed") {
    return <Badge variant="destructive">Ошибка</Badge>;
  }

  let label = "слабое";
  let className = "bg-muted text-muted-foreground";
  if (score >= 90) {
    label = "отличное";
    className = "bg-emerald-600 text-white";
  } else if (score >= 70) {
    label = "хорошее";
    className = "bg-green-600 text-white";
  } else if (score >= 40) {
    label = "частичное";
    className = "bg-amber-500 text-white";
  } else {
    className = "bg-rose-600 text-white";
  }

  return (
    <Badge
      className={`tabular-nums ${className}`}
      title={`Соответствие: ${label}`}
    >
      {score} / 100 · {label}
    </Badge>
  );
}

export function ResumeMatches({
  resumeId,
  hasCategory,
  items,
  total,
}: ResumeMatchesProps) {
  const router = useRouter();
  const queryClient = useQueryClient();

  const computeMutation = useMutation({
    ...orpc.match.compute.mutationOptions(),
    onSuccess: async (res: {
      scored: number;
      failed: number;
      total: number;
      remainingPending: number;
    }) => {
      if (res.total === 0) {
        toast.info("Нет вакансий для оценки в этой категории");
      } else {
        toast.success(
          `Оценено: ${res.scored}, ошибок: ${res.failed}. Осталось в очереди: ${res.remainingPending}`,
        );
      }
      await queryClient.invalidateQueries({ queryKey: orpc.match.key() });
      router.refresh();
    },
    onError: (err: Error) => {
      toast.error(err.message || "Не удалось оценить соответствие");
    },
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-muted-foreground text-sm">
          {total > 0
            ? `Оценок: ${total.toLocaleString("ru-RU")}`
            : "Соответствие ещё не рассчитано"}
        </p>
        <Button
          onClick={() => computeMutation.mutate({ resumeId, limit: 10 })}
          disabled={computeMutation.isPending || !hasCategory}
        >
          <IconSparkles className="size-4" />
          {computeMutation.isPending ? "Оцениваю…" : "Оценить соответствие"}
        </Button>
      </div>

      {!hasCategory && (
        <p className="text-muted-foreground rounded-lg border border-dashed p-4 text-sm">
          У этого резюме не указана категория, поэтому подобрать вакансии для
          оценки нельзя. Категория проставляется при генерации резюме под роль.
        </p>
      )}

      <div className="overflow-hidden rounded-lg border">
        <Table>
          <TableHeader className="bg-muted sticky top-0 z-10">
            <TableRow>
              <TableHead className="w-[45%]">Вакансия</TableHead>
              <TableHead>Компания</TableHead>
              <TableHead className="w-[180px]">Соответствие</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={3}
                  className="text-muted-foreground h-32 text-center"
                >
                  <div className="flex flex-col items-center gap-2">
                    <IconTargetArrow className="size-8 opacity-40" />
                    <span>Нет оценок — нажмите «Оценить соответствие»</span>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              items.map((m) => (
                <TableRow key={m.id}>
                  <TableCell className="font-medium">
                    <a
                      href={m.vacancyUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:text-primary inline-flex items-center gap-1.5 transition-colors"
                    >
                      <span className="line-clamp-2">{m.vacancyTitle}</span>
                      <IconExternalLink className="text-muted-foreground size-3.5 shrink-0" />
                    </a>
                    {m.summary && (
                      <p className="text-muted-foreground mt-1 line-clamp-2 text-xs">
                        {m.summary}
                      </p>
                    )}
                  </TableCell>
                  <TableCell>
                    <span className="text-muted-foreground text-sm">
                      {m.employerName ?? "—"}
                    </span>
                  </TableCell>
                  <TableCell>
                    <ScoreBadge score={m.score} status={m.status} />
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
