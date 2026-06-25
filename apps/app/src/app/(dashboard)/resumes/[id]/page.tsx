import { notFound } from "next/navigation";

import { SiteHeader } from "~/components/layout";
import { ResumeForm } from "~/components/resumes/resume-form";
import { api } from "~/orpc/server";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Редактирование резюме",
};

interface EditResumePageProps {
  params: Promise<{ id: string }>;
}

export default async function EditResumePage({ params }: EditResumePageProps) {
  const { id } = await params;

  const resume = await api.resume.byId({ id }).catch(() => null);

  if (!resume) {
    notFound();
  }

  return (
    <>
      <SiteHeader title="Редактирование резюме" />
      <div className="flex flex-1 flex-col gap-4 p-4 md:gap-6 md:p-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Редактирование резюме
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Внесите изменения и сохраните.
          </p>
        </div>
        <div className="max-w-3xl">
          <ResumeForm
            resumeId={resume.id}
            defaultValues={{
              title: resume.title,
              content: resume.content,
              isDefault: resume.isDefault,
            }}
          />
        </div>
      </div>
    </>
  );
}
