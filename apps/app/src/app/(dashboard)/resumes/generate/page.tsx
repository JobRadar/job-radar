import { SiteHeader } from "~/components/layout";
import { ResumeGenerateForm } from "~/components/resumes/resume-generate-form";
import { api } from "~/orpc/server";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Генерация резюме",
};

export default async function GenerateResumePage() {
  const [{ items: categories }, { items: resumes }] = await Promise.all([
    api.category.list(),
    api.resume.list(),
  ]);

  const baseResumes = resumes.filter((r) => r.kind === "base");

  return (
    <>
      <SiteHeader title="Генерация резюме" />
      <div className="flex flex-1 flex-col gap-4 p-4 md:gap-6 md:p-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Генерация резюме
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Соберём резюме под выбранную роль на основе анализа спарсенных
            вакансий.
          </p>
        </div>
        <div className="max-w-3xl">
          {categories.length === 0 ? (
            <div className="rounded-lg border border-dashed p-8 text-center">
              <p className="font-medium">Нет категорий</p>
              <p className="text-muted-foreground mt-1 text-sm">
                Сначала наполните справочник категорий (seed-скрипт
                <code className="mx-1">db seed:categories</code>).
              </p>
            </div>
          ) : (
            <ResumeGenerateForm
              categories={categories}
              baseResumes={baseResumes}
            />
          )}
        </div>
      </div>
    </>
  );
}
