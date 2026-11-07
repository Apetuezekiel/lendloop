import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { adminMutation, adminQuery, appError, getCurrentUser } from "./lib/auth";
import { vRole } from "./lib/validators";

/**
 * Creates or refreshes the caller's user row from their Clerk identity.
 * Called once by the client after sign-in. New users always start as "user";
 * nothing the client sends can influence the role.
 */
export const ensure = mutation({
  args: {},
  returns: v.id("users"),
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw appError("UNAUTHENTICATED", "Sign in to continue.");

    const name =
      identity.givenName ??
      identity.name?.split(" ")[0] ??
      identity.email?.split("@")[0] ??
      "Neighbour";
    const email = identity.email;

    const existing = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();
    if (existing) {
      if (existing.name !== name || existing.email !== email) {
        await ctx.db.patch(existing._id, { name, email });
      }
      return existing._id;
    }
    return await ctx.db.insert("users", {
      tokenIdentifier: identity.tokenIdentifier,
      name,
      email,
      role: "user",
      trustedLender: false,
    });
  },
});

export const me = query({
  args: {},
  returns: v.union(
    v.null(),
    v.object({
      _id: v.id("users"),
      name: v.string(),
      role: vRole,
      trustedLender: v.boolean(),
    }),
  ),
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) return null;
    return {
      _id: user._id,
      name: user.name,
      role: user.role,
      trustedLender: user.trustedLender,
    };
  },
});

export const listForAdmin = adminQuery({
  args: {},
  returns: v.array(
    v.object({
      _id: v.id("users"),
      name: v.string(),
      email: v.optional(v.string()),
      role: vRole,
      trustedLender: v.boolean(),
      listings: v.number(),
    }),
  ),
  handler: async (ctx) => {
    const users = await ctx.db.query("users").order("desc").take(200);
    return await Promise.all(
      users.map(async (u) => {
        const listings = await ctx.db
          .query("tools")
          .withIndex("by_owner", (q) => q.eq("ownerId", u._id).eq("listingStatus", "listed"))
          .collect();
        return {
          _id: u._id,
          name: u.name,
          email: u.email,
          role: u.role,
          trustedLender: u.trustedLender,
          listings: listings.length,
        };
      }),
    );
  },
});

export const setTrustedLender = adminMutation({
  args: { userId: v.id("users"), trusted: v.boolean() },
  returns: v.null(),
  handler: async (ctx, { userId, trusted }) => {
    const target = await ctx.db.get(userId);
    if (!target) throw appError("NOT_FOUND", "User not found.");
    await ctx.db.patch(userId, { trustedLender: trusted });
    return null;
  },
});

/**
 * Grants or revokes the admin role. Internal, so it cannot be called from a
 * browser at all, only with the deployment's admin key:
 *   npx convex run users:setRole '{"email":"you@example.com","role":"admin"}'
 */
export const setRole = internalMutation({
  args: { email: v.string(), role: vRole },
  returns: v.string(),
  handler: async (ctx, { email, role }) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", email))
      .first();
    if (!user) throw new Error(`No user with email ${email}. Sign in once first.`);
    await ctx.db.patch(user._id, { role });
    return `${email} is now ${role}`;
  },
});
