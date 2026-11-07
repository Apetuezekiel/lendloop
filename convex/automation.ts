import { v } from "convex/values";
import { internal } from "./_generated/api";
import {
  internalAction,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { adminMutation, adminQuery, appError } from "./lib/auth";
import { daysBetween, utcDate } from "./lib/dates";
import { SIGNATURE_HEADER, TIMESTAMP_HEADER, sign } from "./lib/hmac";
import { vActivityKind, vLoanEventType } from "./lib/validators";

// ---------------------------------------------------------------------------
// Outbound: Convex -> n8n request notifications

// Delay before attempt n+1 after attempt n fails. Five attempts over ~13
// minutes rides out an n8n restart; after that the event is marked failed and
// shows up in the admin view with a retry button.
const BACKOFF_MS = [5_000, 30_000, 120_000, 600_000];
const REQUEST_TIMEOUT_MS = 10_000;

/**
 * Builds the webhook body. Data minimisation: n8n receives only what it needs
 * to notify one person about one event. No descriptions, no notes, nothing
 * about the other party, no role or trust flags.
 */
export const buildPayload = internalQuery({
  args: { eventId: v.id("automationEvents") },
  handler: async (ctx, { eventId }) => {
    const event = await ctx.db.get(eventId);
    if (!event || event.status !== "pending") return null;
    const [loan, recipient] = await Promise.all([
      ctx.db.get(event.loanId),
      ctx.db.get(event.recipientId),
    ]);
    if (!loan || !recipient) return null;
    return {
      eventId: event._id,
      type: event.type,
      occurredAt: new Date(event._creationTime).toISOString(),
      loan: {
        id: loan._id,
        toolName: loan.toolName,
        startDate: loan.startDate,
        endDate: loan.endDate,
      },
      recipient: {
        userId: recipient._id,
        firstName: recipient.name,
        email: recipient.email ?? null,
        role: recipient._id === loan.ownerId ? "lender" : "borrower",
      },
    };
  },
});

export const deliver = internalAction({
  args: { eventId: v.id("automationEvents") },
  returns: v.null(),
  handler: async (ctx, { eventId }) => {
    const payload = await ctx.runQuery(internal.automation.buildPayload, { eventId });
    if (!payload) return null; // already delivered, or the loan is gone

    const url = process.env.N8N_REQUEST_WEBHOOK_URL;
    const secret = process.env.CONVEX_TO_N8N_SECRET;
    if (!url || !secret) {
      await ctx.runMutation(internal.automation.recordAttempt, {
        eventId,
        ok: false,
        error: "N8N_REQUEST_WEBHOOK_URL or CONVEX_TO_N8N_SECRET is not set",
        retryable: false,
      });
      return null;
    }

    const body = JSON.stringify(payload);
    const { timestamp, signature } = await sign(secret, body);
    let error: string | null = null;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          [TIMESTAMP_HEADER]: timestamp,
          [SIGNATURE_HEADER]: signature,
        },
        body,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!res.ok) error = `n8n responded ${res.status}`;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
    await ctx.runMutation(internal.automation.recordAttempt, {
      eventId,
      ok: error === null,
      error: error ?? undefined,
      retryable: true,
    });
    return null;
  },
});

export const recordAttempt = internalMutation({
  args: {
    eventId: v.id("automationEvents"),
    ok: v.boolean(),
    error: v.optional(v.string()),
    retryable: v.boolean(),
  },
  returns: v.null(),
  handler: async (ctx, { eventId, ok, error, retryable }) => {
    const event = await ctx.db.get(eventId);
    if (!event || event.status !== "pending") return null;
    const attempts = event.attempts + 1;
    if (ok) {
      await ctx.db.patch(eventId, { status: "delivered", attempts, deliveredAt: Date.now(), lastError: undefined });
      return null;
    }
    const delay = BACKOFF_MS[event.attempts];
    if (retryable && delay !== undefined) {
      await ctx.db.patch(eventId, { attempts, lastError: error });
      await ctx.scheduler.runAfter(delay, internal.automation.deliver, { eventId });
    } else {
      console.error(`automation event ${eventId} failed after ${attempts} attempt(s): ${error}`);
      await ctx.db.patch(eventId, { status: "failed", attempts, lastError: error });
    }
    return null;
  },
});

export const retryEvent = adminMutation({
  args: { eventId: v.id("automationEvents") },
  returns: v.null(),
  handler: async (ctx, { eventId }) => {
    const event = await ctx.db.get(eventId);
    if (!event) throw appError("NOT_FOUND", "Event not found.");
    if (event.status !== "failed") throw appError("CONFLICT", "Only failed events can be retried.");
    await ctx.db.patch(eventId, { status: "pending", attempts: 0, lastError: undefined });
    await ctx.scheduler.runAfter(0, internal.automation.deliver, { eventId });
    return null;
  },
});

// ---------------------------------------------------------------------------
// Inbound: n8n -> Convex (called from http.ts after the signature check)

export const reminderKey = (loanId: string, date: string) => `reminder:${loanId}:${date}`;

/**
 * Overdue loans that have not had a reminder recorded today. Excluding
 * already-reminded loans is what makes a re-run of the daily workflow a no-op.
 */
export const overdueLoans = internalQuery({
  args: {},
  handler: async (ctx) => {
    const today = utcDate(Date.now());
    const loans = await ctx.db
      .query("loans")
      .withIndex("by_status_end", (q) => q.eq("status", "approved").lt("endDate", today))
      .take(500);

    const due = [];
    for (const loan of loans) {
      const key = reminderKey(loan._id, today);
      const sent = await ctx.db
        .query("automationActivity")
        .withIndex("by_key", (q) => q.eq("idempotencyKey", key))
        .unique();
      if (sent) continue;
      const borrower = await ctx.db.get(loan.borrowerId);
      due.push({
        loanId: loan._id,
        toolName: loan.toolName,
        endDate: loan.endDate,
        daysOverdue: daysBetween(loan.endDate, today),
        borrower: { firstName: borrower?.name ?? "Neighbour", email: borrower?.email ?? null },
        idempotencyKey: key,
      });
    }
    return { asOf: today, loans: due };
  },
});

/**
 * Idempotent write-back. Convex mutations are serialisable transactions: if
 * two retries with the same key race, one commits and the other re-runs,
 * sees the row, and reports a duplicate. No lock or Redis needed.
 */
export const recordActivity = internalMutation({
  args: {
    idempotencyKey: v.string(),
    kind: vActivityKind,
    loanId: v.optional(v.string()),
    summary: v.string(),
    workflow: v.string(),
    executionId: v.optional(v.string()),
  },
  returns: v.object({ status: v.union(v.literal("created"), v.literal("duplicate")) }),
  handler: async (ctx, args) => {
    if (args.idempotencyKey.length === 0 || args.idempotencyKey.length > 200) {
      throw new Error("idempotencyKey must be 1 to 200 characters");
    }
    const existing = await ctx.db
      .query("automationActivity")
      .withIndex("by_key", (q) => q.eq("idempotencyKey", args.idempotencyKey))
      .unique();
    if (existing) return { status: "duplicate" as const };

    // Only attach to a loan that really exists; ignore ids that do not parse.
    const loanId = args.loanId ? ctx.db.normalizeId("loans", args.loanId) : null;
    if (args.loanId && (!loanId || !(await ctx.db.get(loanId)))) {
      throw new Error(`Unknown loanId ${args.loanId}`);
    }

    await ctx.db.insert("automationActivity", {
      idempotencyKey: args.idempotencyKey,
      kind: args.kind,
      loanId: loanId ?? undefined,
      summary: args.summary.slice(0, 140),
      workflow: args.workflow.slice(0, 80),
      executionId: args.executionId?.slice(0, 80),
    });
    return { status: "created" as const };
  },
});

// ---------------------------------------------------------------------------
// Admin view

export const overview = adminQuery({
  args: {},
  returns: v.object({
    events: v.array(
      v.object({
        _id: v.id("automationEvents"),
        _creationTime: v.number(),
        type: vLoanEventType,
        toolName: v.string(),
        status: v.union(v.literal("pending"), v.literal("delivered"), v.literal("failed")),
        attempts: v.number(),
        lastError: v.optional(v.string()),
      }),
    ),
    activity: v.array(
      v.object({
        _id: v.id("automationActivity"),
        _creationTime: v.number(),
        kind: vActivityKind,
        summary: v.string(),
        workflow: v.string(),
        executionId: v.optional(v.string()),
      }),
    ),
  }),
  handler: async (ctx) => {
    const [events, activity] = await Promise.all([
      ctx.db.query("automationEvents").order("desc").take(30),
      ctx.db.query("automationActivity").order("desc").take(30),
    ]);
    return {
      events: await Promise.all(
        events.map(async (e) => ({
          _id: e._id,
          _creationTime: e._creationTime,
          type: e.type,
          toolName: (await ctx.db.get(e.loanId))?.toolName ?? "Unknown",
          status: e.status,
          attempts: e.attempts,
          lastError: e.lastError,
        })),
      ),
      activity: activity.map((a) => ({
        _id: a._id,
        _creationTime: a._creationTime,
        kind: a.kind,
        summary: a.summary,
        workflow: a.workflow,
        executionId: a.executionId,
      })),
    };
  },
});
