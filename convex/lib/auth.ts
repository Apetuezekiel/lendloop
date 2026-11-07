import { ConvexError } from "convex/values";
import {
  customCtx,
  customMutation,
  customQuery,
} from "convex-helpers/server/customFunctions";
import { mutation, query, type QueryCtx } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";

// Every public function that needs a signed-in user is built from one of the
// four builders below, so authentication and role checks cannot be forgotten
// in an individual handler. Resource ownership (is this *your* tool?) is
// checked in the handler with the assert helpers, because it depends on the
// document being touched.

export type AppErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "INVALID"
  | "CONFLICT";

export function appError(code: AppErrorCode, message: string): ConvexError<{
  code: AppErrorCode;
  message: string;
}> {
  return new ConvexError({ code, message });
}

export async function getCurrentUser(ctx: QueryCtx): Promise<Doc<"users"> | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;
  return await ctx.db
    .query("users")
    .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
    .unique();
}

async function requireUser(ctx: QueryCtx): Promise<Doc<"users">> {
  const user = await getCurrentUser(ctx);
  if (!user) throw appError("UNAUTHENTICATED", "Sign in to continue.");
  return user;
}

async function requireAdmin(ctx: QueryCtx): Promise<Doc<"users">> {
  const user = await requireUser(ctx);
  if (user.role !== "admin") throw appError("FORBIDDEN", "Admins only.");
  return user;
}

export const userQuery = customQuery(
  query,
  customCtx(async (ctx) => ({ user: await requireUser(ctx) })),
);
export const userMutation = customMutation(
  mutation,
  customCtx(async (ctx) => ({ user: await requireUser(ctx) })),
);
export const adminQuery = customQuery(
  query,
  customCtx(async (ctx) => ({ user: await requireAdmin(ctx) })),
);
export const adminMutation = customMutation(
  mutation,
  customCtx(async (ctx) => ({ user: await requireAdmin(ctx) })),
);

export function assertToolOwner(user: Doc<"users">, tool: Doc<"tools">) {
  if (tool.ownerId !== user._id) {
    throw appError("FORBIDDEN", "You can only change your own listings.");
  }
}

export function assertLender(user: Doc<"users">, loan: Doc<"loans">) {
  if (loan.ownerId !== user._id) {
    throw appError("FORBIDDEN", "Only the owner of this tool can do that.");
  }
}

export function assertBorrower(user: Doc<"users">, loan: Doc<"loans">) {
  if (loan.borrowerId !== user._id) {
    throw appError("FORBIDDEN", "Only the person who made this request can do that.");
  }
}
