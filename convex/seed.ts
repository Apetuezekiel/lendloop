import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import type { Category, Condition } from "./lib/constants";

// Demo neighbours and listings for a local walkthrough. Internal, so it can
// only be run with the deployment's admin key:
//   npx convex run seed:demo
// Demo users have token identifiers no real Clerk session can produce.

const NEIGHBOURS = [
  { name: "Amaka", email: "amaka@demo.lendloop.test", trustedLender: true },
  { name: "Tunde", email: "tunde@demo.lendloop.test", trustedLender: false },
  { name: "Ngozi", email: "ngozi@demo.lendloop.test", trustedLender: false },
];

const TOOLS: [number, string, Category, Condition, string][] = [
  [0, "Pressure washer", "cleaning", "good", "1800W, good for driveways and patios."],
  [0, "Hedge trimmer", "garden", "like_new", "Cordless, battery lasts about 40 minutes."],
  [1, "Stand mixer", "kitchen", "good", "5 litre bowl, dough hook and whisk."],
  [1, "Ladder (3.5 m)", "hand_tools", "fair", "Aluminium extension ladder."],
  [2, "Two-person tent", "camping", "good", "Packs small, pegs included."],
  [2, "Circular saw", "power_tools", "worn", "Works well, blade could use replacing."],
];

export const demo = internalMutation({
  args: {},
  returns: v.string(),
  handler: async (ctx) => {
    const existing = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", NEIGHBOURS[0].email))
      .first();
    if (existing) return "Demo data already present";

    const ids = [];
    for (const n of NEIGHBOURS) {
      ids.push(
        await ctx.db.insert("users", {
          tokenIdentifier: `demo|${n.email}`,
          name: n.name,
          email: n.email,
          role: "user",
          trustedLender: n.trustedLender,
        }),
      );
    }
    for (const [owner, name, category, condition, description] of TOOLS) {
      await ctx.db.insert("tools", {
        ownerId: ids[owner],
        name,
        category,
        condition,
        description,
        availability: "available",
        listingStatus: "listed",
      });
    }
    return `Seeded ${NEIGHBOURS.length} neighbours and ${TOOLS.length} tools`;
  },
});
