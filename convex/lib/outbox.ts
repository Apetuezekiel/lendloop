import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import type { LoanEventType } from "./constants";

// Who hears about each event: the lender learns about new and cancelled
// requests, the borrower learns about decisions on their request.
const RECIPIENT: Record<LoanEventType, "owner" | "borrower"> = {
  "loan.requested": "owner",
  "loan.cancelled": "owner",
  "loan.approved": "borrower",
  "loan.declined": "borrower",
  "loan.returned": "borrower",
};

/**
 * Records a loan event in the outbox and schedules its delivery to n8n.
 *
 * Must be called from the mutation that changes the loan. Convex commits the
 * state change, the outbox row and the scheduled delivery atomically: if the
 * mutation fails, none of them happen, and if it succeeds, delivery is
 * guaranteed to be attempted. No event is lost, and none is sent for a change
 * that rolled back.
 */
export async function enqueueLoanEvent(
  ctx: MutationCtx,
  loan: Doc<"loans">,
  type: LoanEventType,
): Promise<Id<"automationEvents">> {
  const recipientId = RECIPIENT[type] === "owner" ? loan.ownerId : loan.borrowerId;
  const eventId = await ctx.db.insert("automationEvents", {
    loanId: loan._id,
    type,
    recipientId,
    status: "pending",
    attempts: 0,
  });
  await ctx.scheduler.runAfter(0, internal.automation.deliver, { eventId });
  return eventId;
}
