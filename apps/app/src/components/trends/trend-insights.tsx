"use client";

import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  toast,
} from "@job-radar/ui";
import { IconSparkles } from "@tabler/icons-react";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";

import { orpc } from "~/orpc/react";

interface TrendInsightResult {
  summary: string;
  inDemandSkills: string[];
  emergingSkills: string[];
  inDemandRoles: string[];
  recommendations: string[];
  model: string;
}

export function TrendInsights() {
  const [result, setResult] = useState<TrendInsightResult | null>(null);

  const insightsMutation = useMutation({
    ...orpc.trends.insights.mutationOptions(),
    onSuccess: (data: TrendInsightResult) => {
      setResult(data);
    },
    onError: (err: Error) => {
      toast.error(err.message || "Не удалось проанализировать тренды");
    },
  });

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>Анализ трендов (AI)</CardTitle>
            <CardDescription>
              LLM-резюме рынка на основе посчитанной статистики
            </CardDescription>
          </div>
          <Button
            onClick={() => insightsMutation.mutate({ days: 30 })}
            disabled={insightsMutation.isPending}
          >
            <IconSparkles className="size-4" />
            {insightsMutation.isPending
              ? "Анализирую…"
              : result
                ? "Обновить анализ"
                : "Проанализировать"}
          </Button>
        </div>
      </CardHeader>
      {result && (
        <CardContent className="space-y-5">
          <p className="text-sm whitespace-pre-line">{result.summary}</p>

          <InsightGroup
            title="Востребованные навыки"
            items={result.inDemandSkills}
          />
          <InsightGroup
            title="Растущие навыки"
            items={result.emergingSkills}
            tone="emerald"
          />
          <InsightGroup
            title="Востребованные специалисты"
            items={result.inDemandRoles}
          />

          {result.recommendations.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-sm font-medium">Рекомендации</h3>
              <ul className="text-muted-foreground list-disc space-y-1 pl-5 text-sm">
                {result.recommendations.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}

function InsightGroup({
  title,
  items,
  tone,
}: {
  title: string;
  items: string[];
  tone?: "emerald";
}) {
  if (items.length === 0) return null;
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium">{title}</h3>
      <ul className="flex flex-wrap gap-2">
        {items.map((item) => (
          <li key={item}>
            <Badge
              variant="outline"
              className={tone === "emerald" ? "text-emerald-700" : undefined}
            >
              {item}
            </Badge>
          </li>
        ))}
      </ul>
    </div>
  );
}
