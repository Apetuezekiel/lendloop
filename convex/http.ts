import { httpRouter } from "convex/server";
import { internal } from "./_generated/api";
import { httpAction, type ActionCtx } from "./_generated/server";
import { SIGNATURE_HEADER, TIMESTAMP_HEADER, verify } from "./lib/hmac";

// Endpoints for n8n. Every request must carry a valid HMAC signature made
// with N8N_TO_CONVEX_SECRET (a different secret from the one Convex uses to
// sign its own webhooks, so one leaking cannot forge the other direction).
// Each body names its action, so a body signed for one endpoint is rejected
// by the others.

const http = httpRouter();

type Handler = (ctx: ActionCtx, body: Record<string, unknown>) => Promise<unknown>;

function signedEndpoint(action: string, handler: Handler) {
  return httpAction(async (ctx, req) => {
    const secret = process.env.N8N_TO_CONVEX_SECRET;
    if (!secret) return json({ error: "Endpoint not configured" }, 503);

    const raw = await req.text();
    const check = await verify(
      secret,
      raw,
      req.headers.get(TIMESTAMP_HEADER),
      req.headers.get(SIGNATURE_HEADER),
    );
    if (!check.ok) {
      // Log the reason for operators; tell the caller nothing useful.
      console.warn(`Rejected n8n request to ${action}: ${check.reason}`);
      return json({ error: "Invalid signature" }, 401);
    }

    let body: Record<string, unknown>;
    try {
      body = JSON.parse(raw);
    } catch {
      return json({ error: "Body must be JSON" }, 400);
    }
    if (body?.action !== action) return json({ error: `Expected action ${action}` }, 400);

    try {
      return json(await handler(ctx, body), 200);
    } catch (e) {
      // Argument validation failures from the internal mutation land here.
      const message = e instanceof Error ? e.message : String(e);
      return json({ error: message.split("\n")[0] }, 400);
    }
  });
}

function json(data: unknown, status: number) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

http.route({
  path: "/n8n/overdue-loans",
  method: "POST",
  handler: signedEndpoint("loans.listOverdue", (ctx) =>
    ctx.runQuery(internal.automation.overdueLoans, {}),
  ),
});

http.route({
  path: "/n8n/activity",
  method: "POST",
  // Field types are checked by recordActivity's argument validator; a bad
  // value comes back as a 400.
  handler: signedEndpoint("activity.record", (ctx, body) =>
    ctx.runMutation(internal.automation.recordActivity, {
      idempotencyKey: body.idempotencyKey as string,
      kind: body.kind as never,
      loanId: (body.loanId as string | null | undefined) ?? undefined,
      summary: body.summary as string,
      workflow: body.workflow as string,
      executionId: (body.executionId as string | null | undefined) ?? undefined,
    }),
  ),
});

export default http;
