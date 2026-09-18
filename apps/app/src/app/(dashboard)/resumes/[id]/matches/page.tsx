import { notFound } from "next/navigation";

import { SiteHeader } from "~/components/layout";
import {
  type MatchItem,
  ResumeMatches,
} from "~/components/resumes/resume-matches";
import { api } from "~/orpc/server";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Соответствие резюме",
};

interface ResumeMatchesPageProps {
  params: Promise<{ id: string }>;
}

export default async function ResumeMatchesPage({
  params,
}: ResumeMatchesPageProps) {
  const { id } = await params;

  const resume = await api.resume.byId({ id }).catch(() => null);
  if (!resume) {
    notFound();
  }

  const { items, total } = await api.match.list({ resumeId: id, limit: 100 });

  const matchItems: MatchItem[] = items.map((m) => ({
    id: m.id,
    vacancyId: m.vacancyId,
    score: m.score,
    summary: m.summary,
    status: m.status as MatchItem["status"],
    vacancyTitle: m.vacancyTitle,
    employerName: m.employerName,
    vacancyUrl: m.vacancyUrl,
  }));

  return (
    <>
      <SiteHeader title="Соответствие резюме" />
      <div className="flex flex-1 flex-col gap-4 p-4 md:gap-6 md:p-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Соответствие: {resume.title}
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Оценка резюме против вакансий его категории с помощью LLM.
          </p>
        </div>
        <ResumeMatches
          resumeId={resume.id}
          hasCategory={Boolean(resume.categoryId)}
          items={matchItems}
          total={total}
        />
      </div>
    </>
  );
}
