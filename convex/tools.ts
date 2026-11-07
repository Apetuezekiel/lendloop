import { v } from "convex/values";
import { query, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import {
  adminQuery,
  appError,
  assertToolOwner,
  userMutation,
  userQuery,
} from "./lib/auth";
import { LIMITS } from "./lib/constants";
import { enqueueLoanEvent } from "./lib/outbox";
import { vCategory, vCondition } from "./lib/validators";

const PAGE = 200;

/**
 * The public board. Anonymous callers get name and category only: no owner,
 * no description, no ids that could be used to look anything else up.
 */
export const listPublic = query({
  args: {},
  returns: v.array(v.object({ name: v.string(), category: vCategory })),
  handler: async (ctx) => {
    const tools = await ctx.db
      .query("tools")
      .withIndex("by_listing_availability_category", (q) =>
        q.eq("listingStatus", "listed").eq("availability", "available"),
      )
      .take(PAGE);
    return tools.map(({ name, category }) => ({ name, category }));
  },
});

const vBoardTool = v.object({
  _id: v.id("tools"),
  name: v.string(),
  category: vCategory,
  condition: vCondition,
  description: v.string(),
  availability: v.union(v.literal("available"), v.literal("on_loan")),
  owner: v.object({ name: v.string(), trustedLender: v.boolean() }),
  isMine: v.boolean(),
  myPendingRequest: v.boolean(),
});

/** Signed-in board: every listed tool with availability, optional category filter. */
export const browse = userQuery({
  args: { category: v.optional(vCategory) },
  returns: v.array(vBoardTool),
  handler: async (ctx, { category }) => {
    const tools = await ctx.db
      .query("tools")
      .withIndex("by_listing_category", (q) =>
        category
          ? q.eq("listingStatus", "listed").eq("category", category)
          : q.eq("listingStatus", "listed"),
      )
      .order("desc")
      .take(PAGE);

    const owners = await loadOwners(ctx, tools);
    const pendingToolIds = new Set(
      (
        await ctx.db
          .query("loans")
          .withIndex("by_borrower", (q) => q.eq("borrowerId", ctx.user._id))
          .collect()
      )
        .filter((loan) => loan.status === "pending")
        .map((loan) => loan.toolId),
    );

    return tools.map((tool) => {
      const owner = owners.get(tool.ownerId);
      return {
        _id: tool._id,
        name: tool.name,
        category: tool.category,
        condition: tool.condition,
        description: tool.description,
        availability: tool.availability,
        // Neighbours see a first name and the trust badge, never an email.
        owner: { name: owner?.name ?? "Neighbour", trustedLender: owner?.trustedLender ?? false },
        isMine: tool.ownerId === ctx.user._id,
        myPendingRequest: pendingToolIds.has(tool._id),
      };
    });
  },
});

/** "My listings": the caller's own tools with request counts. */
export const mine = userQuery({
  args: {},
  returns: v.array(
    v.object({
      _id: v.id("tools"),
      name: v.string(),
      category: vCategory,
      condition: vCondition,
      description: v.string(),
      availability: v.union(v.literal("available"), v.literal("on_loan")),
      pendingRequests: v.number(),
    }),
  ),
  handler: async (ctx) => {
    const tools = await ctx.db
      .query("tools")
      .withIndex("by_owner", (q) => q.eq("ownerId", ctx.user._id).eq("listingStatus", "listed"))
      .order("desc")
      .collect();
    return await Promise.all(
      tools.map(async (tool) => {
        const pending = await ctx.db
          .query("loans")
          .withIndex("by_tool_status", (q) => q.eq("toolId", tool._id).eq("status", "pending"))
          .collect();
        return {
          _id: tool._id,
          name: tool.name,
          category: tool.category,
          condition: tool.condition,
          description: tool.description,
          availability: tool.availability,
          pendingRequests: pending.length,
        };
      }),
    );
  },
});

const toolFields = {
  name: v.string(),
  category: vCategory,
  condition: vCondition,
  description: v.string(),
};

export const create = userMutation({
  args: toolFields,
  returns: v.id("tools"),
  handler: async (ctx, args) => {
    const fields = cleanToolFields(args);
    return await ctx.db.insert("tools", {
      ...fields,
      ownerId: ctx.user._id,
      availability: "available",
      listingStatus: "listed",
    });
  },
});

export const update = userMutation({
  args: { toolId: v.id("tools"), ...toolFields },
  returns: v.null(),
  handler: async (ctx, { toolId, ...args }) => {
    const tool = await getListedTool(ctx, toolId);
    assertToolOwner(ctx.user, tool);
    await ctx.db.patch(toolId, cleanToolFields(args));
    return null;
  },
});

/**
 * Owners can remove their own listing when it is not on loan. Admins can
 * remove any listing (moderation); an active loan carries on and can still be
 * marked returned. Pending requests are declined and the borrowers notified.
 */
export const remove = userMutation({
  args: { toolId: v.id("tools") },
  returns: v.null(),
  handler: async (ctx, { toolId }) => {
    const tool = await getListedTool(ctx, toolId);
    const isAdmin = ctx.user.role === "admin";
    if (!isAdmin) {
      assertToolOwner(ctx.user, tool);
      if (tool.availability === "on_loan") {
        throw appError("CONFLICT", "This tool is on loan. Mark it returned before removing it.");
      }
    }
    await ctx.db.patch(toolId, { listingStatus: "removed", removedBy: ctx.user._id });

    const pending = await ctx.db
      .query("loans")
      .withIndex("by_tool_status", (q) => q.eq("toolId", toolId).eq("status", "pending"))
      .collect();
    for (const loan of pending) {
      // A removed listing declines its open requests, and the borrower is told.
      await ctx.db.patch(loan._id, { status: "declined", decidedAt: Date.now() });
      await enqueueLoanEvent(ctx, loan, "loan.declined");
    }
    return null;
  },
});

/** Admin view of every live listing, including the owner's email for moderation. */
export const listForAdmin = adminQuery({
  args: {},
  returns: v.array(
    v.object({
      _id: v.id("tools"),
      name: v.string(),
      category: vCategory,
      availability: v.union(v.literal("available"), v.literal("on_loan")),
      owner: v.object({
        name: v.string(),
        email: v.optional(v.string()),
        trustedLender: v.boolean(),
      }),
    }),
  ),
  handler: async (ctx) => {
    const tools = await ctx.db
      .query("tools")
      .withIndex("by_listing_category", (q) => q.eq("listingStatus", "listed"))
      .take(PAGE);
    const owners = await loadOwners(ctx, tools);
    return tools.map((tool) => {
      const owner = owners.get(tool.ownerId);
      return {
        _id: tool._id,
        name: tool.name,
        category: tool.category,
        availability: tool.availability,
        owner: {
          name: owner?.name ?? "Unknown",
          email: owner?.email,
          trustedLender: owner?.trustedLender ?? false,
        },
      };
    });
  },
});

// ---------------------------------------------------------------------------

async function getListedTool(ctx: QueryCtx, toolId: Id<"tools">): Promise<Doc<"tools">> {
  const tool = await ctx.db.get(toolId);
  if (!tool || tool.listingStatus !== "listed") throw appError("NOT_FOUND", "Tool not found.");
  return tool;
}

async function loadOwners(ctx: QueryCtx, tools: Doc<"tools">[]) {
  const ids = [...new Set(tools.map((t) => t.ownerId))];
  const docs = await Promise.all(ids.map((id) => ctx.db.get(id)));
  return new Map(docs.filter((d) => d !== null).map((d) => [d._id, d]));
}

function cleanToolFields(args: {
  name: string;
  category: Doc<"tools">["category"];
  condition: Doc<"tools">["condition"];
  description: string;
}) {
  const name = args.name.trim().replace(/\s+/g, " ");
  const description = args.description.trim();
  if (name.length < LIMITS.toolName.min || name.length > LIMITS.toolName.max) {
    throw appError(
      "INVALID",
      `Name must be ${LIMITS.toolName.min} to ${LIMITS.toolName.max} characters.`,
    );
  }
  if (description.length > LIMITS.description.max) {
    throw appError("INVALID", `Description must be ${LIMITS.description.max} characters or fewer.`);
  }
  return { name, category: args.category, condition: args.condition, description };
}
