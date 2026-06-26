"use client";

import { paths } from "@job-radar/config";
import type { ResumeRow } from "@job-radar/db/schema";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
  toast,
} from "@job-radar/ui";
import {
  IconEdit,
  IconFileText,
  IconTarget,
  IconTrash,
} from "@tabler/icons-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { orpc } from "~/orpc/react";

export function ResumeList({ items }: { items: ResumeRow[] }) {
  const router = useRouter();
  const queryClient = useQueryClient();

  const deleteMutation = useMutation({
    ...orpc.resume.delete.mutationOptions(),
    onSuccess: async () => {
      toast.success("Резюме удалено");
      await queryClient.invalidateQueries({ queryKey: orpc.resume.key() });
      router.refresh();
    },
    onError: (err: Error) => {
      toast.error(err.message || "Не удалось удалить резюме");
    },
  });

  function handleDelete(resume: ResumeRow) {
    const confirmed = window.confirm(
      `Удалить резюме «${resume.title}»? Действие необратимо.`,
    );
    if (confirmed) {
      deleteMutation.mutate({ id: resume.id });
    }
  }

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 rounded-lg border border-dashed py-16 text-center">
        <IconFileText className="text-muted-foreground size-10 opacity-40" />
        <div className="space-y-1">
          <p className="font-medium">Резюме пока нет</p>
          <p className="text-muted-foreground text-sm">
            Создайте первое резюме, чтобы откликаться на вакансии.
          </p>
        </div>
        <Button asChild>
          <Link href={paths.resumes.new}>Создать резюме</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {items.map((resume) => (
        <Card key={resume.id} className="flex flex-col">
          <CardHeader>
            <div className="flex items-start justify-between gap-2">
              <CardTitle className="line-clamp-2">{resume.title}</CardTitle>
              <div className="flex shrink-0 items-center gap-1">
                {resume.kind === "generated" && (
                  <Badge variant="secondary">Сгенерировано</Badge>
                )}
                {resume.isDefault && <Badge>Основное</Badge>}
              </div>
            </div>
          </CardHeader>
          <CardContent className="flex-1">
            {resume.content ? (
              <p className="text-muted-foreground line-clamp-4 text-sm whitespace-pre-line">
                {resume.content}
              </p>
            ) : (
              <p className="text-muted-foreground/70 text-sm italic">
                Без описания
              </p>
            )}
          </CardContent>
          <CardFooter className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground text-xs tabular-nums">
              {format(new Date(resume.createdAt), "d MMM yyyy", { locale: ru })}
            </span>
            <div className="flex items-center gap-1">
              <Button variant="outline" size="sm" asChild>
                <Link href={paths.resumes.matches(resume.id)}>
                  <IconTarget className="size-4" />
                  Соответствие
                </Link>
              </Button>
              <Button variant="outline" size="sm" asChild>
                <Link href={paths.resumes.byId(resume.id)}>
                  <IconEdit className="size-4" />
                  Изменить
                </Link>
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="text-muted-foreground hover:text-destructive size-8"
                onClick={() => handleDelete(resume)}
                disabled={deleteMutation.isPending}
                aria-label={`Удалить резюме ${resume.title}`}
              >
                <IconTrash className="size-4" />
              </Button>
            </div>
          </CardFooter>
        </Card>
      ))}
    </div>
  );
}
