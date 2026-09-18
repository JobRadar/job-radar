import { Card, CardDescription, CardHeader, CardTitle } from "@job-radar/ui";

import { SiteHeader } from "~/components/layout";
import { TrendInsights } from "~/components/trends/trend-insights";
import { TrendsCharts } from "~/components/trends/trends-charts";
import { api } from "~/orpc/server";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Тренды рынка",
};

export default async function TrendsPage() {
  const [overview, topSkills, risingSkills, demandByCategory, timeline] =
    await Promise.all([
      api.trends.overview(),
      api.trends.topSkills({ limit: 20 }),
      api.trends.risingSkills({ days: 30, limit: 20 }),
      api.trends.demandByCategory(),
      api.trends.timeline({ weeks: 12 }),
    ]);

  const cards = [
    { label: "Всего вакансий", value: overview.totalVacancies },
    { label: "Новых за 7 дней", value: overview.newLast7Days },
    { label: "Новых за 30 дней", value: overview.newLast30Days },
    { label: "Уникальных навыков", value: overview.distinctSkills },
  ];

  return (
    <>
      <SiteHeader title="Тренды рынка" />
      <div className="flex flex-1 flex-col gap-4 p-4 md:gap-6 md:p-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Тренды рынка</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Какие навыки и специалисты востребованы — по вашим спаршенным
            вакансиям.
          </p>
        </div>

        {/* Сводка */}
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {cards.map((c) => (
            <Card key={c.label} className="@container/card">
              <CardHeader>
                <CardDescription>{c.label}</CardDescription>
                <CardTitle className="text-2xl font-semibold tabular-nums @[200px]/card:text-3xl">
                  {c.value.toLocaleString("ru-RU")}
                </CardTitle>
              </CardHeader>
            </Card>
          ))}
        </div>

        {/* AI-анализ */}
        <TrendInsights />

        {/* Графики */}
        <TrendsCharts
          topSkills={topSkills.items}
          risingSkills={risingSkills.items}
          demandByCategory={demandByCategory.items}
          timeline={timeline.items}
        />
      </div>
    </>
  );
}
