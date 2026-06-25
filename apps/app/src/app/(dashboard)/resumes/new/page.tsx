import { SiteHeader } from "~/components/layout";
import { ResumeForm } from "~/components/resumes/resume-form";

export const metadata = {
  title: "Новое резюме",
};

export default function NewResumePage() {
  return (
    <>
      <SiteHeader title="Новое резюме" />
      <div className="flex flex-1 flex-col gap-4 p-4 md:gap-6 md:p-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Новое резюме</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Заполните название и содержимое резюме.
          </p>
        </div>
        <div className="max-w-3xl">
          <ResumeForm />
        </div>
      </div>
    </>
  );
}
