import { logger, task, wait } from "@trigger.dev/sdk";

export const helloWorldTask = task({
  id: "hello-world",
  run: async (payload: { name?: string }) => {
    logger.log("Hello from Trigger.dev", { payload });

    await wait.for({ seconds: 1 });

    return { message: `Hello, ${payload.name ?? "world"}!` };
  },
});
