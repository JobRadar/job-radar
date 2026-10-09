"use client";

import { paths } from "@job-radar/config";
import type { HhSalary } from "@job-radar/db/schema";
import { Badge, Button, Card, CardContent, toast } from "@job-radar/ui";
import {
  IconArrowBackUp,
  IconCheck,
  IconCopy,
  IconExternalLink,
  IconLoader2,
  IconPlayerPlay,
  IconPlayerSkipForward,
} from "@tabler/icons-react";
import { useMutation } from "@tanstack/react-query";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { orpc } from "~/orpc/react";

type Status = "todo" | "applied" | "skipped";

export interface ApplicationItem {
  id: string;
  status: Status;
  score: number;
  summary: string | null;
  coverLetter: string;
  createdAt: Date;
  appliedAt: Date | null;
  vacancyTitle: string;
  vacancyUrl: string;
  employerName: string | null;
  salary: HhSalary | null;
  area: string | null;
  schedule: string | null;
  isVacancyArchived: boolean;
}

interface ApplicationListProps {
  status: Status;
  counts: Record<Status, number>;
  items: ApplicationItem[];
}

const TABS: { status: Status; label: string; href: string }[] = [
  { status: "todo", label: "К отклику", href: paths.applications.root },
  {
    status: "applied",
    label: "Отправлены",
    href: `${paths.applications.root}?status=applied`,
  },
  {
    status: "skipped",
    label: "Пропущены",
    href: `${paths.applications.root}?status=skipped`,
  },
];

const EMPTY_TEXT: Record<Status, string> = {
  todo: "Пока нет задач. Нажмите «Подобрать вакансии» — или дождитесь автоматического прогона.",
  applied: "Вы ещё не отметили ни одного отклика отправленным.",
  skipped: "Пропущенных вакансий нет.",
};

function formatSalary(salary: HhSalary | null): string | null {
  if (!salary || (salary.from == null && salary.to == null)) return null;
  const nf = (n: number) => n.toLocaleString("ru-RU");
  const range =
    salary.from != null && salary.to != null
      ? `${nf(salary.from)}–${nf(salary.to)}`
      : salary.from != null
        ? `от ${nf(salary.from)}`
        : `до ${nf(salary.to as number)}`;
  return `${range} ${salary.currency}${salary.gross ? "" : " на руки"}`;
}

/** Копирование в буфер: не бросает, если Clipboard API недоступен (http, WebView). */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function ApplicationCard({
  item,
  onSetStatus,
  isPending,
}: {
  item: ApplicationItem;
  onSetStatus: (id: string, status: Status) => void;
  isPending: boolean;
}) {
  const salary = formatSalary(item.salary);
  const meta = [item.employerName, item.area, salary, item.schedule].filter(
    Boolean,
  );

  async function handleCopy() {
    const ok = await copyText(item.coverLetter);
    if (ok) {
      toast.success("Письмо скопировано");
    } else {
      toast.error("Не удалось скопировать — выделите текст вручную");
    }
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <h2 className="text-base leading-snug font-semibold">
              {item.vacancyTitle}
            </h2>
            {meta.length > 0 && (
              <p className="text-muted-foreground text-sm">
                {meta.join(" · ")}
              </p>
            )}
          </div>
          <Badge className="shrink-0 bg-emerald-600 tabular-nums text-white">
            {item.score}/100
          </Badge>
        </div>

        {item.isVacancyArchived && item.status === "todo" && (
          <p className="rounded-md bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
            Вакансия давно не встречалась в выдаче — возможно, уже закрыта.
          </p>
        )}

        {item.summary && (
          <p className="text-muted-foreground text-sm">{item.summary}</p>
        )}

        <details
          className="group rounded-md border"
          open={item.status === "todo"}
        >
          <summary className="cursor-pointer px-3 py-2 text-sm font-medium select-none">
            Сопроводительное письмо
          </summary>
          <p className="border-t px-3 py-3 text-sm whitespace-pre-line">
            {item.coverLetter || "Письмо не сгенерировано"}
          </p>
        </details>

        {item.status === "todo" ? (
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            <Button
              asChild
              size="lg"
              className="sm:flex-1"
              // Копируем письмо в момент тапа и сразу открываем вакансию:
              // на телефоне остаётся нажать «Откликнуться» и вставить текст.
              onClick={() => void handleCopy()}
            >
              <a
                href={item.vacancyUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                <IconExternalLink className="size-4" />
                Копировать письмо и открыть hh.ru
              </a>
            </Button>
            <Button
              variant="outline"
              size="lg"
              onClick={() => void handleCopy()}
              disabled={!item.coverLetter}
            >
              <IconCopy className="size-4" />
              Только письмо
            </Button>
            <Button
              variant="outline"
              size="lg"
              onClick={() => onSetStatus(item.id, "applied")}
              disabled={isPending}
            >
              <IconCheck className="size-4" />
              Откликнулся
            </Button>
            <Button
              variant="ghost"
              size="lg"
              className="text-muted-foreground"
              onClick={() => onSetStatus(item.id, "skipped")}
              disabled={isPending}
            >
              <IconPlayerSkipForward className="size-4" />
              Пропустить
            </Button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-muted-foreground text-xs">
              {item.status === "applied" && item.appliedAt
                ? `Отклик отправлен ${format(new Date(item.appliedAt), "d MMM, HH:mm", { locale: ru })}`
                : `Создана ${format(new Date(item.createdAt), "d MMM, HH:mm", { locale: ru })}`}
            </span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" asChild>
                <a
                  href={item.vacancyUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <IconExternalLink className="size-4" />
                  Вакансия
                </a>
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => onSetStatus(item.id, "todo")}
                disabled={isPending}
              >
                <IconArrowBackUp className="size-4" />
                Вернуть в работу
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function ApplicationList({
  status,
  counts,
  items,
}: ApplicationListProps) {
  const router = useRouter();

  const statusMutation = useMutation({
    ...orpc.application.setStatus.mutationOptions(),
    onSuccess: (_data, vars) => {
      toast.success(
        vars.status === "applied"
          ? "Отмечено: отклик отправлен"
          : vars.status === "skipped"
            ? "Вакансия пропущена"
            : "Возвращено в работу",
      );
      router.refresh();
    },
    onError: (err: Error) => {
      toast.error(err.message || "Не удалось обновить задачу");
    },
  });

  const runMutation = useMutation({
    ...orpc.application.run.mutationOptions(),
    onSuccess: () => {
      toast.success("Подбор запущен", {
        description:
          "Оцениваю свежие вакансии и пишу письма. Новые задачи появятся через несколько минут.",
      });
      router.refresh();
    },
    onError: (err: Error) => {
      toast.error("Не удалось запустить подбор", { description: err.message });
    },
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav
          aria-label="Статус откликов"
          className="bg-muted inline-flex max-w-full overflow-x-auto rounded-lg p-[3px]"
        >
          {TABS.map((tab) => (
            <Link
              key={tab.status}
              href={tab.href}
              aria-current={tab.status === status ? "page" : undefined}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium whitespace-nowrap transition-colors ${
                tab.status === status
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {tab.label}
              <span className="text-muted-foreground tabular-nums">
                {counts[tab.status]}
              </span>
            </Link>
          ))}
        </nav>

        <Button
          onClick={() => runMutation.mutate({})}
          disabled={runMutation.isPending}
        >
          {runMutation.isPending ? (
            <IconLoader2 className="size-4 animate-spin" />
          ) : (
            <IconPlayerPlay className="size-4" />
          )}
          {runMutation.isPending ? "Запуск…" : "Подобрать вакансии"}
        </Button>
      </div>

      {items.length === 0 ? (
        <p className="text-muted-foreground rounded-lg border border-dashed p-8 text-center text-sm">
          {EMPTY_TEXT[status]}
        </p>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {items.map((item) => (
            <ApplicationCard
              key={item.id}
              item={item}
              isPending={statusMutation.isPending}
              onSetStatus={(id, next) =>
                statusMutation.mutate({ id, status: next })
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}
