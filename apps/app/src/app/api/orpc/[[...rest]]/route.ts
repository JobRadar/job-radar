import { appRouter, createORPCContext } from "@job-radar/api";
import { logger } from "@job-radar/config";
import { onError } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const handler = new RPCHandler(appRouter, {
  interceptors: [
    onError((error) => {
      logger.error("orpc.handler_error", error);
    }),
  ],
});

async function handleRequest(request: Request) {
  const { auth } = await import("~/auth/server");

  const session = await auth.api.getSession({ headers: request.headers });

  const { response } = await handler.handle(request, {
    prefix: "/api/orpc",
    context: createORPCContext({
      headers: request.headers,
      session,
    }),
  });

  return response ?? new Response("Not found", { status: 404 });
}

export const HEAD = handleRequest;
export const GET = handleRequest;
export const POST = handleRequest;
export const PUT = handleRequest;
export const PATCH = handleRequest;
export const DELETE = handleRequest;
