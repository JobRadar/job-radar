import { hatchet } from "./client";
import { helloWorldTask } from "./workflows/hello-world";
import { processDocumentWorkflow } from "./workflows/multi-step";
import { scheduledWorkflow } from "./workflows/scheduled";
import { scrapeHhWorkflow } from "./workflows/scrape-hh";
import { scrapeHhScheduledWorkflow } from "./workflows/scrape-hh-scheduled";

/**
 * Hatchet worker — long-running process that polls the Hatchet engine
 * and executes registered workflows/tasks.
 *
 * Start the worker locally:
 * ```bash
 * bun run dev         # from packages/jobs
 * # or from the repo root:
 * bun run dev --filter @job-radar/jobs
 * ```
 *
 * The worker connects to Hatchet using HATCHET_CLIENT_TOKEN.
 * Set it in your .env file before running.
 *
 * @see https://docs.hatchet.run/home/workers
 */
async function main() {
  const worker = await hatchet.worker("job-radar-worker", {
    workflows: [
      helloWorldTask,
      scheduledWorkflow,
      processDocumentWorkflow,
      scrapeHhWorkflow,
      scrapeHhScheduledWorkflow,
    ],
    // Maximum number of concurrent task runs this worker will accept.
    // Tune based on the workload's CPU/memory profile.
    // Playwright скрапинг ресурсоёмкий — держим низкий concurrency.
    slots: 10,
  });

  await worker.start();
}

main().catch((_err) => {
  process.exit(1);
});
