"use client";

import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@job-radar/ui";
import { IconTrendingUp } from "@tabler/icons-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  XAxis,
  YAxis,
} from "recharts";

export interface SkillDatum {
  skill: string;
  count: number;
}
export interface RisingDatum {
  skill: string;
  recent: number;
  previous: number;
  delta: number;
}
export interface DemandDatum {
  label: string;
  total: number;
  recent: number;
}
export interface TimelineDatum {
  week: string;
  count: number;
}

const skillsConfig = {
  count: { label: "Вакансий", color: "var(--primary)" },
} satisfies ChartConfig;

const demandConfig = {
  total: { label: "Всего", color: "var(--primary)" },
} satisfies ChartConfig;

const timelineConfig = {
  count: { label: "Вакансий", color: "var(--primary)" },
} satisfies ChartConfig;

export function TrendsCharts({
  topSkills,
  risingSkills,
  demandByCategory,
  timeline,
}: {
  topSkills: SkillDatum[];
  risingSkills: RisingDatum[];
  demandByCategory: DemandDatum[];
  timeline: TimelineDatum[];
}) {
  const topSkillsData = topSkills.slice(0, 15);

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {/* Топ навыков */}
      <Card>
        <CardHeader>
          <CardTitle>Востребованные навыки</CardTitle>
          <CardDescription>
            Частота упоминания навыков в вакансиях
          </CardDescription>
        </CardHeader>
        <CardContent>
          {topSkillsData.length === 0 ? (
            <EmptyChart />
          ) : (
            <ChartContainer config={skillsConfig} className="h-[420px] w-full">
              <BarChart
                accessibilityLayer
                data={topSkillsData}
                layout="vertical"
                margin={{ left: 12, right: 16 }}
              >
                <CartesianGrid horizontal={false} />
                <YAxis
                  dataKey="skill"
                  type="category"
                  width={150}
                  tickLine={false}
                  axisLine={false}
                  tickMargin={6}
                />
                <XAxis type="number" dataKey="count" hide />
                <ChartTooltip
                  cursor={false}
                  content={<ChartTooltipContent />}
                />
                <Bar dataKey="count" fill="var(--color-count)" radius={4} />
              </BarChart>
            </ChartContainer>
          )}
        </CardContent>
      </Card>

      {/* Спрос по ролям */}
      <Card>
        <CardHeader>
          <CardTitle>Спрос по ролям</CardTitle>
          <CardDescription>Сколько вакансий в каждой категории</CardDescription>
        </CardHeader>
        <CardContent>
          {demandByCategory.length === 0 ? (
            <EmptyChart />
          ) : (
            <ChartContainer config={demandConfig} className="h-[420px] w-full">
              <BarChart
                accessibilityLayer
                data={demandByCategory}
                layout="vertical"
                margin={{ left: 12, right: 16 }}
              >
                <CartesianGrid horizontal={false} />
                <YAxis
                  dataKey="label"
                  type="category"
                  width={150}
                  tickLine={false}
                  axisLine={false}
                  tickMargin={6}
                />
                <XAxis type="number" dataKey="total" hide />
                <ChartTooltip
                  cursor={false}
                  content={<ChartTooltipContent />}
                />
                <Bar dataKey="total" fill="var(--color-total)" radius={4} />
              </BarChart>
            </ChartContainer>
          )}
        </CardContent>
      </Card>

      {/* Динамика по неделям */}
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>Динамика появления вакансий</CardTitle>
          <CardDescription>Число новых вакансий по неделям</CardDescription>
        </CardHeader>
        <CardContent>
          {timeline.length === 0 ? (
            <EmptyChart />
          ) : (
            <ChartContainer
              config={timelineConfig}
              className="h-[260px] w-full"
            >
              <AreaChart
                accessibilityLayer
                data={timeline}
                margin={{ left: 12, right: 12 }}
              >
                <defs>
                  <linearGradient id="fillTrend" x1="0" y1="0" x2="0" y2="1">
                    <stop
                      offset="5%"
                      stopColor="var(--color-count)"
                      stopOpacity={0.8}
                    />
                    <stop
                      offset="95%"
                      stopColor="var(--color-count)"
                      stopOpacity={0.1}
                    />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} />
                <XAxis
                  dataKey="week"
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  minTickGap={24}
                  tickFormatter={(value: string) =>
                    new Date(value).toLocaleDateString("ru-RU", {
                      day: "numeric",
                      month: "short",
                    })
                  }
                />
                <ChartTooltip
                  cursor={false}
                  content={
                    <ChartTooltipContent
                      labelFormatter={(value) =>
                        new Date(value as string).toLocaleDateString("ru-RU", {
                          day: "numeric",
                          month: "long",
                        })
                      }
                    />
                  }
                />
                <Area
                  dataKey="count"
                  type="natural"
                  fill="url(#fillTrend)"
                  stroke="var(--color-count)"
                />
              </AreaChart>
            </ChartContainer>
          )}
        </CardContent>
      </Card>

      {/* Растущие навыки */}
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>Растущие навыки</CardTitle>
          <CardDescription>
            Прирост спроса за период по сравнению с предыдущим
          </CardDescription>
        </CardHeader>
        <CardContent>
          {risingSkills.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              Недостаточно данных для расчёта динамики. Нужны вакансии за два
              периода подряд.
            </p>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {risingSkills.map((s) => (
                <li key={s.skill}>
                  <Badge
                    variant="outline"
                    className="gap-1.5 py-1 tabular-nums"
                    title={`Было: ${s.previous}, стало: ${s.recent}`}
                  >
                    <IconTrendingUp className="size-3.5 text-emerald-600" />
                    {s.skill}
                    <span className="text-emerald-600">+{s.delta}</span>
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function EmptyChart() {
  return (
    <div className="text-muted-foreground flex h-[200px] items-center justify-center text-sm">
      Нет данных — запустите скрапинг вакансий
    </div>
  );
}
