"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { paths } from "@job-radar/config";
import { Button, Checkbox, Input, Label, Textarea, toast } from "@job-radar/ui";
import { type ResumeFormValues, resumeFormSchema } from "@job-radar/validators";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";

import { orpc } from "~/orpc/react";

interface ResumeFormProps {
  /** Если передан — форма работает в режиме редактирования */
  resumeId?: string;
  defaultValues?: Partial<ResumeFormValues>;
}

export function ResumeForm({ resumeId, defaultValues }: ResumeFormProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const isEdit = Boolean(resumeId);

  const form = useForm<ResumeFormValues>({
    resolver: zodResolver(resumeFormSchema),
    defaultValues: {
      title: defaultValues?.title ?? "",
      content: defaultValues?.content ?? "",
      isDefault: defaultValues?.isDefault ?? false,
    },
    mode: "onSubmit",
  });

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = form;

  async function onSuccess() {
    await queryClient.invalidateQueries({ queryKey: orpc.resume.key() });
    router.push(paths.resumes.root);
    router.refresh();
  }

  const createMutation = useMutation({
    ...orpc.resume.create.mutationOptions(),
    onSuccess: async () => {
      toast.success("Резюме создано");
      await onSuccess();
    },
    onError: (err: Error) => {
      toast.error(err.message || "Не удалось создать резюме");
    },
  });

  const updateMutation = useMutation({
    ...orpc.resume.update.mutationOptions(),
    onSuccess: async () => {
      toast.success("Изменения сохранены");
      await onSuccess();
    },
    onError: (err: Error) => {
      toast.error(err.message || "Не удалось сохранить изменения");
    },
  });

  const isPending = createMutation.isPending || updateMutation.isPending;

  function onSubmit(data: ResumeFormValues) {
    if (resumeId) {
      updateMutation.mutate({ ...data, id: resumeId });
    } else {
      createMutation.mutate(data);
    }
  }

  const isDefault = watch("isDefault");

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      {/* Название */}
      <div className="space-y-2">
        <Label htmlFor="title">Название</Label>
        <Input
          id="title"
          placeholder="Например, Frontend-разработчик…"
          autoComplete="off"
          aria-invalid={Boolean(errors.title)}
          {...register("title")}
        />
        {errors.title && (
          <p className="text-destructive text-sm" role="alert">
            {errors.title.message}
          </p>
        )}
      </div>

      {/* Содержимое */}
      <div className="space-y-2">
        <Label htmlFor="content">Содержимое</Label>
        <Textarea
          id="content"
          placeholder="Опыт работы, навыки, достижения…"
          className="min-h-[320px] font-mono text-sm"
          aria-invalid={Boolean(errors.content)}
          {...register("content")}
        />
        {errors.content && (
          <p className="text-destructive text-sm" role="alert">
            {errors.content.message}
          </p>
        )}
      </div>

      {/* Основное резюме */}
      <div className="flex items-start gap-3 rounded-lg border p-4">
        <Checkbox
          id="isDefault"
          checked={isDefault}
          onCheckedChange={(checked) =>
            setValue("isDefault", checked === true, { shouldDirty: true })
          }
          className="mt-0.5"
        />
        <div className="grid gap-1">
          <Label htmlFor="isDefault" className="cursor-pointer">
            Основное резюме
          </Label>
          <p className="text-muted-foreground text-sm">
            Будет использоваться по умолчанию при отклике на вакансии.
          </p>
        </div>
      </div>

      {/* Действия */}
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={isPending}>
          {isPending
            ? "Сохранение…"
            : isEdit
              ? "Сохранить изменения"
              : "Создать резюме"}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={isPending}
          onClick={() => router.push(paths.resumes.root)}
        >
          Отмена
        </Button>
      </div>
    </form>
  );
}
