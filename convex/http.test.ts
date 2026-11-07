import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import schema from "./schema";
import { modules } from "./test.setup";
import { SIGNATURE_HEADER, TIMESTAMP_HEADER, sign, verify } from "./lib/hmac";

const SECRET = "test-secret-n8n-to-convex";

beforeEach(() => vi.stubEnv("N8N_TO_CONVEX_SECRET", SECRET));
afterEach(() => vi.unstubAllEnvs());

describe("hmac", () => {
  test("round trip, tampering, wrong secret and stale timestamps", async () => {
    const body = JSON.stringify({ hello: "world" });
    const { timestamp, signature } = await sign(SECRET, body);
    expect(await verify(SECRET, body, timestamp, signature)).toEqual({ ok: true });
    expect(await verify(SECRET, body + " ", timestamp, signature)).toEqual({ ok: false, reason: "mismatch" });
    expect(await verify("other-secret", body, timestamp, signature)).toEqual({ ok: false, reason: "mismatch" });
    expect(await verify(SECRET, body, String(Number(timestamp) - 301), signature)).toEqual({
      ok: false,
      reason: "stale",
    });
    expect(await verify(SECRET, body, timestamp, "v1=zz")).toEqual({ ok: false, reason: "malformed" });
    expect(await verify(SECRET, body, null, signature)).toEqual({ ok: false, reason: "missing" });
  });
});

async function signedPost(t: ReturnType<typeof convexTest>, path: string, payload: unknown, secret = SECRET) {
  const body = JSON.stringify(payload);
  const { timestamp, signature } = await sign(secret, body);
  const init = {
    method: "POST",
    headers: { "Content-Type": "application/json", [TIMESTAMP_HEADER]: timestamp, [SIGNATURE_HEADER]: signature },
    body,
  };
  return { init, res: await t.fetch(path, init) };
}

describe("n8n endpoints", () => {
  const activity = {
    action: "activity.record",
    idempotencyKey: "workflow_failed:exec-1",
    kind: "workflow_failed",
    summary: "Overdue reminders failed at node Fetch overdue loans",
    workflow: "LendLoop error handler",
    executionId: "exec-1",
  };

  test("accepts a signed write and treats a replay as a duplicate", async () => {
    const t = convexTest(schema, modules);
    const { init, res } = await signedPost(t, "/n8n/activity", activity);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "created" });

    // Exact same request again (same timestamp and signature): a replay.
    const replay = await t.fetch("/n8n/activity", init);
    expect(replay.status).toBe(200);
    expect(await replay.json()).toEqual({ status: "duplicate" });
    expect(await t.run((ctx) => ctx.db.query("automationActivity").collect())).toHaveLength(1);
  });

  test("rejects unsigned, wrongly signed and cross-endpoint requests", async () => {
    const t = convexTest(schema, modules);
    const unsigned = await t.fetch("/n8n/activity", { method: "POST", body: JSON.stringify(activity) });
    expect(unsigned.status).toBe(401);

    const { res: wrongSecret } = await signedPost(t, "/n8n/activity", activity, "not-the-secret");
    expect(wrongSecret.status).toBe(401);

    // A validly signed body meant for the activity endpoint, sent to another one.
    const { res: crossed } = await signedPost(t, "/n8n/overdue-loans", activity);
    expect(crossed.status).toBe(400);

    const { res: badKind } = await signedPost(t, "/n8n/activity", { ...activity, kind: "drop_tables" });
    expect(badKind.status).toBe(400);
    expect(await t.run((ctx) => ctx.db.query("automationActivity").collect())).toHaveLength(0);
  });

  test("overdue endpoint returns a signed caller the list", async () => {
    const t = convexTest(schema, modules);
    const { res } = await signedPost(t, "/n8n/overdue-loans", { action: "loans.listOverdue" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ loans: [] });
  });
});
