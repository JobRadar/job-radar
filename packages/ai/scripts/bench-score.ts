/**
 * Бенчмарк моделей для скоринга резюме↔вакансия.
 *
 * Запуск из корня репозитория (подхватит .env):
 *   bun packages/ai/scripts/bench-score.ts gemini-3.8-flash deepseek-v4.1-flash
 *
 * Для каждой модели прогоняет 3 синтетические вакансии (сильное совпадение,
 * частичное, нерелевантная) по REPEATS раз и печатает оценки, задержку и ошибки.
 */
import { scoreResumeVacancy } from "../src/score";

const REPEATS = Number(process.env.REPEATS ?? 2);

const RESUME = `# Иван Петров — Frontend-разработчик
Опыт: 4 года. Москва.
Навыки: TypeScript, React, Next.js, Redux Toolkit, Jest, Playwright, Webpack, Vite, REST, GraphQL, Git, Docker (базово).
Опыт работы:
- 2022–н.в. Яндекс Маркет — разработка SPA на React/Next.js, оптимизация Core Web Vitals, покрытие тестами 80%.
- 2020–2022 Тинькофф — интернет-банк на React + Redux, компонентная библиотека.
Образование: МГТУ им. Баумана, ИУ5.`;

const VACANCIES = [
  {
    label: "сильное",
    title: "Senior Frontend-разработчик (React, TypeScript)",
    skills: ["React", "TypeScript", "Next.js", "Jest"],
    experience: "От 3 до 6 лет",
    employerName: "Ozon",
    description:
      "Развиваем витрину маркетплейса на React и Next.js. Нужно уверенное знание TypeScript, опыт оптимизации производительности, юнит- и e2e-тесты.",
  },
  {
    label: "частичное",
    title: "Fullstack-разработчик (Node.js + React)",
    skills: ["Node.js", "NestJS", "PostgreSQL", "React", "Kubernetes"],
    experience: "От 3 до 6 лет",
    employerName: "Сбер",
    description:
      "Делаем внутренние сервисы: бэкенд на NestJS и PostgreSQL, фронт на React. Деплой в Kubernetes, CI/CD, проектирование API.",
  },
  {
    label: "нерелевантное",
    title: "Go-разработчик (высоконагруженные системы)",
    skills: ["Go", "Kafka", "ClickHouse", "gRPC", "Kubernetes"],
    experience: "От 5 лет",
    employerName: "VK",
    description:
      "Разработка высоконагруженных бэкенд-сервисов на Go, потоковая обработка в Kafka, аналитика в ClickHouse. Фронтенд не нужен.",
  },
];

const models = process.argv.slice(2);
if (models.length === 0) {
  console.error("Укажите модели: bun packages/ai/scripts/bench-score.ts <id…>");
  process.exit(1);
}

console.log(
  `repeats=${REPEATS}`,
);

for (const modelId of models) {
  const cells: string[] = [];
  const times: number[] = [];
  let failures = 0;
  let firstError = "";

  for (const v of VACANCIES) {
    const scores: string[] = [];
    for (let i = 0; i < REPEATS; i++) {
      const t0 = performance.now();
      try {
        const r = await scoreResumeVacancy({
          resumeContent: RESUME,
          vacancy: v,
          modelId,
        });
        times.push(performance.now() - t0);
        scores.push(String(Math.round(r.score)));
      } catch (e) {
        failures++;
        scores.push("ERR");
        firstError ||= (e instanceof Error ? e.message : String(e)).slice(
          0,
          160,
        );
      }
    }
    cells.push(`${v.label}=${scores.join("/")}`);
  }

  const avg = times.length
    ? Math.round(times.reduce((a, b) => a + b, 0) / times.length)
    : 0;
  console.log(
    `${modelId.padEnd(22)} ${cells.join("  ")}  avg=${avg}ms  fail=${failures}` +
      (firstError ? `  [${firstError}]` : ""),
  );
}
