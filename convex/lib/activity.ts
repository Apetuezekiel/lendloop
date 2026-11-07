import { v, type Infer } from "convex/values";
import type { Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";

export const vActivityItem = v.object({
  label: v.string(),
  at: v.number(),
  tone: v.union(v.literal("ok"), v.literal("pending"), v.literal("error")),
});
export type ActivityItem = Infer<typeof vActivityItem>;

/**
 * Recent automation activity for one loan, newest first: what n8n reported
 * back (notifications, reminders) plus outbox deliveries that are still
 * queued or have failed, so a stuck integration is visible on the loan itself.
 */
export async function loanActivity(
  ctx: QueryCtx,
  loanId: Id<"loans">,
  limit = 4,
): Promise<ActivityItem[]> {
  const [written, events] = await Promise.all([
    ctx.db
      .query("automationActivity")
      .withIndex("by_loan", (q) => q.eq("loanId", loanId))
      .order("desc")
      .take(limit),
    ctx.db
      .query("automationEvents")
      .withIndex("by_loan", (q) => q.eq("loanId", loanId))
      .order("desc")
      .take(limit),
  ]);

  const items: ActivityItem[] = written.map((a) => ({
    label: a.summary,
    at: a._creationTime,
    tone: a.kind === "reminder_failed" || a.kind === "workflow_failed" ? "error" : "ok",
  }));
  for (const e of events) {
    if (e.status === "pending") {
      items.push({
        label: e.attempts > 0 ? `Notification retrying (attempt ${e.attempts + 1})` : "Notification queued",
        at: e._creationTime,
        tone: "pending",
      });
    } else if (e.status === "failed") {
      items.push({ label: "Notification could not be delivered", at: e._creationTime, tone: "error" });
    }
  }
  return items.sort((a, b) => b.at - a.at).slice(0, limit);
}
