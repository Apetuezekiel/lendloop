import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { loanActivity, vActivityItem } from "./lib/activity";
import {
  adminQuery,
  appError,
  assertBorrower,
  assertLender,
  userMutation,
  userQuery,
} from "./lib/auth";
import { LIMITS, type LoanStatus } from "./lib/constants";
import { addDays, daysBetween, isIsoDate, utcDate } from "./lib/dates";
import { enqueueLoanEvent } from "./lib/outbox";
import { vCategory, vLoanStatus } from "./lib/validators";

// Lifecycle:  pending -> approved -> returned
//                     -> declined
//                     -> cancelled (by the borrower)
// Approving hands the tool over: it is on loan until marked returned, and
// the end date is the due date used for overdue reminders.

export const request = userMutation({
  args: {
    toolId: v.id("tools"),
    startDate: v.string(),
    endDate: v.string(),
    note: v.optional(v.string()),
  },
  returns: v.id("loans"),
  handler: async (ctx, { toolId, startDate, endDate, note }) => {
    const tool = await ctx.db.get(toolId);
    if (!tool || tool.listingStatus !== "listed") throw appError("NOT_FOUND", "Tool not found.");
    if (tool.ownerId === ctx.user._id) {
      throw appError("FORBIDDEN", "You cannot borrow your own tool.");
    }
    validateRange(startDate, endDate);
    const cleanNote = note?.trim() || undefined;
    if (cleanNote && cleanNote.length > LIMITS.note.max) {
      throw appError("INVALID", `Notes must be ${LIMITS.note.max} characters or fewer.`);
    }

    const existing = await ctx.db
      .query("loans")
      .withIndex("by_tool_status", (q) => q.eq("toolId", toolId).eq("status", "pending"))
      .collect();
    if (existing.some((loan) => loan.borrowerId === ctx.user._id)) {
      throw appError("CONFLICT", "You already have a pending request for this tool.");
    }

    const loanId = await ctx.db.insert("loans", {
      toolId,
      toolName: tool.name,
      ownerId: tool.ownerId,
      borrowerId: ctx.user._id,
      startDate,
      endDate,
      note: cleanNote,
      status: "pending",
    });
    await enqueueLoanEvent(ctx, (await ctx.db.get(loanId))!, "loan.requested");
    return loanId;
  },
});

export const approve = userMutation({
  args: { loanId: v.id("loans") },
  returns: v.null(),
  handler: async (ctx, { loanId }) => {
    const loan = await getLoan(ctx, loanId);
    assertLender(ctx.user, loan);
    assertStatus(loan, "pending");
    const tool = await ctx.db.get(loan.toolId);
    if (!tool || tool.listingStatus !== "listed") {
      throw appError("CONFLICT", "This listing has been removed.");
    }
    if (tool.availability === "on_loan") {
      throw appError("CONFLICT", "This tool is already on loan. Mark it returned first.");
    }
    await ctx.db.patch(loanId, { status: "approved", decidedAt: Date.now() });
    await ctx.db.patch(tool._id, { availability: "on_loan", activeLoanId: loanId });
    await enqueueLoanEvent(ctx, loan, "loan.approved");
    return null;
  },
});

export const decline = userMutation({
  args: { loanId: v.id("loans") },
  returns: v.null(),
  handler: async (ctx, { loanId }) => {
    const loan = await getLoan(ctx, loanId);
    assertLender(ctx.user, loan);
    assertStatus(loan, "pending");
    await ctx.db.patch(loanId, { status: "declined", decidedAt: Date.now() });
    await enqueueLoanEvent(ctx, loan, "loan.declined");
    return null;
  },
});

export const cancel = userMutation({
  args: { loanId: v.id("loans") },
  returns: v.null(),
  handler: async (ctx, { loanId }) => {
    const loan = await getLoan(ctx, loanId);
    assertBorrower(ctx.user, loan);
    assertStatus(loan, "pending");
    await ctx.db.patch(loanId, { status: "cancelled", decidedAt: Date.now() });
    await enqueueLoanEvent(ctx, loan, "loan.cancelled");
    return null;
  },
});

/** The lender confirms the tool came back. */
export const markReturned = userMutation({
  args: { loanId: v.id("loans") },
  returns: v.null(),
  handler: async (ctx, { loanId }) => {
    const loan = await getLoan(ctx, loanId);
    assertLender(ctx.user, loan);
    assertStatus(loan, "approved");
    await ctx.db.patch(loanId, { status: "returned", returnedAt: Date.now() });
    const tool = await ctx.db.get(loan.toolId);
    if (tool?.activeLoanId === loanId) {
      await ctx.db.patch(tool._id, { availability: "available", activeLoanId: undefined });
    }
    await enqueueLoanEvent(ctx, loan, "loan.returned");
    return null;
  },
});

// ---------------------------------------------------------------------------
// Views

const vLoanView = v.object({
  _id: v.id("loans"),
  _creationTime: v.number(),
  toolName: v.string(),
  category: v.optional(vCategory),
  startDate: v.string(),
  endDate: v.string(),
  note: v.optional(v.string()),
  status: vLoanStatus,
  overdueDays: v.number(),
  counterpart: v.object({ name: v.string(), trustedLender: v.boolean() }),
  activity: v.array(vActivityItem),
});

/** "My requests": everything the caller asked to borrow, newest first. */
export const myRequests = userQuery({
  args: {},
  returns: v.array(vLoanView),
  handler: async (ctx) => {
    const loans = await ctx.db
      .query("loans")
      .withIndex("by_borrower", (q) => q.eq("borrowerId", ctx.user._id))
      .order("desc")
      .take(100);
    return await Promise.all(loans.map((loan) => toView(ctx, loan, loan.ownerId)));
  },
});

const STATUS_ORDER: Record<LoanStatus, number> = {
  pending: 0,
  approved: 1,
  returned: 2,
  declined: 3,
  cancelled: 4,
};

/** "Incoming requests": requests on the caller's tools, open ones first. */
export const incoming = userQuery({
  args: {},
  returns: v.array(vLoanView),
  handler: async (ctx) => {
    const loans = await ctx.db
      .query("loans")
      .withIndex("by_owner_status", (q) => q.eq("ownerId", ctx.user._id))
      .order("desc")
      .take(200);
    loans.sort(
      (a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || b._creationTime - a._creationTime,
    );
    return await Promise.all(loans.map((loan) => toView(ctx, loan, loan.borrowerId)));
  },
});

/** Admin: every loan with both parties. */
export const listForAdmin = adminQuery({
  args: {},
  returns: v.array(
    v.object({
      _id: v.id("loans"),
      _creationTime: v.number(),
      toolName: v.string(),
      startDate: v.string(),
      endDate: v.string(),
      status: vLoanStatus,
      overdueDays: v.number(),
      lender: v.string(),
      borrower: v.string(),
      activity: v.array(vActivityItem),
    }),
  ),
  handler: async (ctx) => {
    const loans = await ctx.db.query("loans").order("desc").take(200);
    const today = utcDate(Date.now());
    return await Promise.all(
      loans.map(async (loan) => {
        const [lender, borrower, activity] = await Promise.all([
          ctx.db.get(loan.ownerId),
          ctx.db.get(loan.borrowerId),
          loanActivity(ctx, loan._id, 3),
        ]);
        return {
          _id: loan._id,
          _creationTime: loan._creationTime,
          toolName: loan.toolName,
          startDate: loan.startDate,
          endDate: loan.endDate,
          status: loan.status,
          overdueDays: overdueDays(loan, today),
          lender: lender?.name ?? "Unknown",
          borrower: borrower?.name ?? "Unknown",
          activity,
        };
      }),
    );
  },
});

// ---------------------------------------------------------------------------

async function getLoan(ctx: QueryCtx, loanId: Id<"loans">): Promise<Doc<"loans">> {
  const loan = await ctx.db.get(loanId);
  if (!loan) throw appError("NOT_FOUND", "Request not found.");
  return loan;
}

function assertStatus(loan: Doc<"loans">, expected: LoanStatus) {
  if (loan.status !== expected) {
    throw appError("CONFLICT", `This request is ${loan.status}, so that action is no longer available.`);
  }
}

function validateRange(startDate: string, endDate: string) {
  if (!isIsoDate(startDate) || !isIsoDate(endDate)) {
    throw appError("INVALID", "Dates must be valid calendar dates.");
  }
  // One day of grace either side of UTC so a neighbour in UTC-something can
  // still pick "today" in their own time zone.
  if (startDate < addDays(utcDate(Date.now()), -1)) {
    throw appError("INVALID", "The start date is in the past.");
  }
  if (endDate < startDate) throw appError("INVALID", "The end date is before the start date.");
  if (daysBetween(startDate, endDate) > LIMITS.maxLoanDays) {
    throw appError("INVALID", `Loans can last at most ${LIMITS.maxLoanDays} days.`);
  }
}

export function overdueDays(loan: Doc<"loans">, today: string): number {
  return loan.status === "approved" && loan.endDate < today ? daysBetween(loan.endDate, today) : 0;
}

async function toView(ctx: QueryCtx, loan: Doc<"loans">, counterpartId: Id<"users">) {
  const [counterpart, tool, activity] = await Promise.all([
    ctx.db.get(counterpartId),
    ctx.db.get(loan.toolId),
    loanActivity(ctx, loan._id),
  ]);
  return {
    _id: loan._id,
    _creationTime: loan._creationTime,
    toolName: loan.toolName,
    category: tool?.category,
    startDate: loan.startDate,
    endDate: loan.endDate,
    note: loan.note,
    status: loan.status,
    overdueDays: overdueDays(loan, utcDate(Date.now())),
    counterpart: {
      name: counterpart?.name ?? "Neighbour",
      trustedLender: counterpart?.trustedLender ?? false,
    },
    activity,
  };
}
