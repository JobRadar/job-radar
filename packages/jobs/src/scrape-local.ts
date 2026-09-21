import { eq } from "@job-radar/db";
import { db } from "@job-radar/db/client";
import { ScrapeRun, SearchKeyword } from "@job-radar/db/schema";
import type { WorkFormat } from "@job-radar/scraper";
import { archiveStaleVacancies, scrapeAndSaveKeyword } from "./scrape-hh-core";

/**
 * Локальный запуск скрапинга hh.ru БЕЗ Hatchet-воркера.
 *
 * Выполняет ту же работу, что и Hatchet workflow `scrape-hh`
 * (см. `workflows/scrape-hh.ts`), но прямо в этом процессе — не требует
 * HATCHET_CLIENT_TOKEN и подключения к Hatchet engine, поэтому ничто не
 * мешает скрапингу, если Hatchet недоступен или не настроен.
 *
 * Запуск:
 *   bun run scrape:local                       # все активные SearchKeyword
 *   bun run scrape:local --keyword-id=<uuid>    # только одно ключевое слово
 *   bun run scrape:local --max-pages=1
 */

interface CliArgs {
  keywordId?: string;
  maxPages?: number;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  const get = (flag: string) => {
    const hit = args.find((a) => a.startsWith(`${flag}=`));
    return hit ? hit.slice(flag.length + 1) : undefined;
  };
  const maxPagesRaw = get("--max-pages");
  return {
    keywordId: get("--keyword-id"),
    maxPages: maxPagesRaw ? Number(maxPagesRaw) : undefined,
  };
}

type SearchKeywordRow = typeof SearchKeyword.$inferSelect;

async function scrapeKeyword(keyword: SearchKeywordRow, maxPagesArg?: number) {
  console.log(
    `\n=== ${keyword.keyword ?? "(по professionalRoles)"} [${keyword.id}] ===`,
  );

  const [scrapeRun] = await db
    .insert(ScrapeRun)
    .values({ keywordId: keyword.id, status: "running" })
    .returning({ id: ScrapeRun.id });

  if (!scrapeRun) {
    throw new Error("Не удалось создать запись ScrapeRun");
  }

  const workFormatRaw = keyword.workFormat ?? null;
  const ALLOWED = new Set(["REMOTE", "OFFICE", "HYBRID", "FIELD_WORK"]);
  const workFormat: WorkFormat[] | undefined = workFormatRaw
    ? workFormatRaw
        .split(",")
        .map((v) => v.trim())
        .filter((v): v is WorkFormat => ALLOWED.has(v))
    : undefined;

  const { vacanciesFound, vacanciesNew, errors } = await scrapeAndSaveKeyword({
    scrapeRunId: scrapeRun.id,
    keywordId: keyword.id,
    categoryId: keyword.categoryId ?? undefined,
    keyword: keyword.keyword ?? undefined,
    professionalRoles: keyword.professionalRoles ?? undefined,
    area: keyword.area,
    experience: keyword.experience ?? undefined,
    employment: keyword.employment ?? undefined,
    workFormat,
    maxPages: maxPagesArg,
  });

  const { archivedCount } = await archiveStaleVacancies(keyword.id);

  await db
    .update(ScrapeRun)
    .set({ status: "completed", completedAt: new Date() })
    .where(eq(ScrapeRun.id, scrapeRun.id));

  console.log(
    `Найдено: ${vacanciesFound}, новых: ${vacanciesNew}, заархивировано: ${archivedCount}`,
  );
  if (errors.length > 0) {
    console.warn("Ошибки:", errors);
  }
}

async function main() {
  const cli = parseArgs();

  const keywords = cli.keywordId
    ? await db.query.SearchKeyword.findMany({
        where: eq(SearchKeyword.id, cli.keywordId),
      })
    : await db.query.SearchKeyword.findMany({
        where: eq(SearchKeyword.isActive, true),
      });

  if (keywords.length === 0) {
    console.log(
      "Нет ключевых слов для скрапинга (проверьте --keyword-id или наличие активных SearchKeyword).",
    );
    return;
  }

  for (const keyword of keywords) {
    if (!keyword.isActive) {
      console.warn(`Пропускаю ${keyword.id}: неактивен`);
      continue;
    }
    if (!keyword.keyword && !keyword.professionalRoles?.length) {
      console.warn(
        `Пропускаю ${keyword.id}: нет ни keyword, ни professionalRoles`,
      );
      continue;
    }
    await scrapeKeyword(keyword, cli.maxPages);
  }

  console.log("\nГотово!\n");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("\n❌ scrape-local провалился:", err);
    process.exit(1);
  });
