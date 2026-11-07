import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import {
  vActivityKind,
  vCategory,
  vCondition,
  vLoanEventType,
  vLoanStatus,
  vRole,
} from "./lib/validators";

export default defineSchema({
  // One row per Clerk user, created on first sign-in by users.ensure.
  // `role` is the only source of truth for authorization. It is never read
  // from the client or from JWT claims, and only changes through an internal
  // mutation (CLI or dashboard).
  users: defineTable({
    tokenIdentifier: v.string(),
    name: v.string(),
    email: v.optional(v.string()),
    role: vRole,
    trustedLender: v.boolean(),
  })
    .index("by_token", ["tokenIdentifier"])
    .index("by_email", ["email"]),

  tools: defineTable({
    ownerId: v.id("users"),
    name: v.string(),
    category: vCategory,
    condition: vCondition,
    description: v.string(),
    // Denormalised so the public board and the category filter are single
    // index reads instead of a join against loans.
    availability: v.union(v.literal("available"), v.literal("on_loan")),
    activeLoanId: v.optional(v.id("loans")),
    // Soft delete keeps loan history intact after a listing is removed.
    listingStatus: v.union(v.literal("listed"), v.literal("removed")),
    removedBy: v.optional(v.id("users")),
  })
    .index("by_owner", ["ownerId", "listingStatus"])
    .index("by_listing_category", ["listingStatus", "category"])
    .index("by_listing_availability_category", [
      "listingStatus",
      "availability",
      "category",
    ]),

  // A borrow request and, once approved, the loan itself.
  loans: defineTable({
    toolId: v.id("tools"),
    toolName: v.string(), // snapshot, survives listing edits and removal
    ownerId: v.id("users"),
    borrowerId: v.id("users"),
    startDate: v.string(), // YYYY-MM-DD, calendar date
    endDate: v.string(), // YYYY-MM-DD, the due date
    note: v.optional(v.string()),
    status: vLoanStatus,
    decidedAt: v.optional(v.number()),
    returnedAt: v.optional(v.number()),
  })
    .index("by_owner_status", ["ownerId", "status"])
    .index("by_borrower", ["borrowerId"])
    .index("by_tool_status", ["toolId", "status"])
    .index("by_status_end", ["status", "endDate"]),

  // Transactional outbox: written in the same mutation as the state change,
  // then delivered to n8n by a scheduled action with retries.
  automationEvents: defineTable({
    loanId: v.id("loans"),
    type: vLoanEventType,
    recipientId: v.id("users"),
    status: v.union(
      v.literal("pending"),
      v.literal("delivered"),
      v.literal("failed"),
    ),
    attempts: v.number(),
    lastError: v.optional(v.string()),
    deliveredAt: v.optional(v.number()),
  })
    .index("by_loan", ["loanId"])
    .index("by_status", ["status"]),

  // Idempotent write-backs from n8n. idempotencyKey is unique by construction:
  // recordActivity checks the index inside a serialisable mutation.
  automationActivity: defineTable({
    idempotencyKey: v.string(),
    kind: vActivityKind,
    loanId: v.optional(v.id("loans")),
    summary: v.string(),
    workflow: v.string(),
    executionId: v.optional(v.string()),
  })
    .index("by_key", ["idempotencyKey"])
    .index("by_loan", ["loanId"]),
});
