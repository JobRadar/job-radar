import type { MarketAnalysis } from "./types";

export interface VacancyForAnalysis {
  title: string;
  skills?: string[] | null;
  salary?: {
    from?: number | null;
    to?: number | null;
    currency?: string;
  } | null;
}

/**
 * Детерминированный анализ рынка по списку вакансий категории.
 *
 * Считает частоту навыков, типичные должности и зарплатную подсказку —
 * без обращения к LLM. Результат подаётся на вход генерации резюме.
 */
export function analyzeMarket(
  categoryLabel: string,
  vacancies: VacancyForAnalysis[],
  options: { topSkillsLimit?: number; topTitlesLimit?: number } = {},
): MarketAnalysis {
  const topSkillsLimit = options.topSkillsLimit ?? 30;
  const topTitlesLimit = options.topTitlesLimit ?? 8;

  const skillCounts = new Map<string, { skill: string; count: number }>();
  const titleCounts = new Map<string, number>();
  const salaries: number[] = [];
  let currency = "RUR";

  for (const v of vacancies) {
    for (const raw of v.skills ?? []) {
      const skill = raw.trim();
      if (!skill) continue;
      const key = skill.toLowerCase();
      const entry = skillCounts.get(key);
      if (entry) {
        entry.count += 1;
      } else {
        skillCounts.set(key, { skill, count: 1 });
      }
    }

    const title = v.title.trim();
    if (title) {
      titleCounts.set(title, (titleCounts.get(title) ?? 0) + 1);
    }

    if (v.salary) {
      if (v.salary.currency) currency = v.salary.currency;
      const mid = midSalary(v.salary.from, v.salary.to);
      if (mid !== null) salaries.push(mid);
    }
  }

  const topSkills = [...skillCounts.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, topSkillsLimit);

  const commonTitles = [...titleCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, topTitlesLimit)
    .map(([title]) => title);

  return {
    categoryLabel,
    vacancyCount: vacancies.length,
    topSkills,
    commonTitles,
    salaryHint: salaryHint(salaries, currency),
  };
}

function midSalary(from?: number | null, to?: number | null): number | null {
  if (typeof from === "number" && typeof to === "number")
    return (from + to) / 2;
  if (typeof from === "number") return from;
  if (typeof to === "number") return to;
  return null;
}

function salaryHint(salaries: number[], currency: string): string | undefined {
  if (salaries.length === 0) return undefined;
  const sorted = [...salaries].sort((a, b) => a - b);
  const p = (q: number) =>
    Math.round(
      sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0,
    );
  return `медиана ~${p(0.5).toLocaleString("ru-RU")} ${currency} (диапазон ${p(0.25).toLocaleString("ru-RU")}–${p(0.75).toLocaleString("ru-RU")})`;
}
