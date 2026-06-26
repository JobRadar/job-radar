import {
  type KeywordItem,
  KeywordManager,
} from "~/components/keywords/keyword-manager";
import { SiteHeader } from "~/components/layout";
import { api } from "~/orpc/server";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Ключевые слова",
};

export default async function KeywordsPage() {
  const [{ items }, { items: categories }] = await Promise.all([
    api.keyword.list(),
    api.category.list(),
  ]);

  const keywords: KeywordItem[] = items.map((k) => ({
    id: k.id,
    keyword: k.keyword,
    categoryId: k.categoryId,
    categoryLabel: k.categoryLabel,
    area: k.area,
    salaryFrom: k.salaryFrom,
    salaryTo: k.salaryTo,
    experience: k.experience,
    employment: k.employment,
    isActive: k.isActive,
    createdAt: k.createdAt,
  }));

  return (
    <>
      <SiteHeader title="Ключевые слова" />
      <div className="flex flex-1 flex-col gap-4 p-4 md:gap-6 md:p-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Ключевые слова</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Поисковые запросы для скрапинга вакансий. Привяжите запрос к
            категории — и вакансии будут попадать в нужную роль.
          </p>
        </div>
        <KeywordManager items={keywords} categories={categories} />
      </div>
    </>
  );
}
