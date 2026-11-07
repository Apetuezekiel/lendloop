import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { modules } from "./test.setup";
import { addDays, utcDate } from "./lib/dates";

// These tests call the real exported Convex functions against convex-test's
// in-memory backend, with the identity Convex would derive from a Clerk JWT.

const today = utcDate(Date.now());

async function setup() {
  const t = convexTest(schema, modules);
  const ada = t.withIdentity({ tokenIdentifier: "clerk|ada", name: "Ada Obi", email: "ada@example.com" });
  const bola = t.withIdentity({ tokenIdentifier: "clerk|bola", name: "Bola Ade", email: "bola@example.com" });
  const chidi = t.withIdentity({ tokenIdentifier: "clerk|chidi", name: "Chidi Eze", email: "chidi@example.com" });
  const admin = t.withIdentity({ tokenIdentifier: "clerk|admin", name: "Admin Ola", email: "admin@example.com" });
  for (const who of [ada, bola, chidi, admin]) await who.mutation(api.users.ensure, {});
  await t.mutation(internal.users.setRole, { email: "admin@example.com", role: "admin" });

  const drill = await ada.mutation(api.tools.create, {
    name: "Cordless drill",
    category: "power_tools",
    condition: "good",
    description: "18V with two batteries",
  });
  return { t, ada, bola, chidi, admin, drill };
}

const rejects = (p: Promise<unknown>, code: string) =>
  expect(p).rejects.toMatchObject({ data: expect.objectContaining({ code }) });

describe("authentication", () => {
  test("anonymous callers can only read the public board", async () => {
    const { t } = await setup();
    await rejects(t.query(api.tools.browse, {}), "UNAUTHENTICATED");
    await rejects(
      t.mutation(api.tools.create, { name: "Saw", category: "hand_tools", condition: "good", description: "" }),
      "UNAUTHENTICATED",
    );
    expect(await t.query(api.tools.listPublic, {})).toEqual([
      { name: "Cordless drill", category: "power_tools" },
    ]);
  });

  test("new users always start as plain users", async () => {
    const { t } = await setup();
    const eve = t.withIdentity({ tokenIdentifier: "clerk|eve", name: "Eve", email: "eve@example.com" });
    await eve.mutation(api.users.ensure, {});
    expect(await eve.query(api.users.me, {})).toMatchObject({ role: "user", trustedLender: false });
  });
});

describe("listing ownership", () => {
  test("a user cannot edit or delete someone else's listing", async () => {
    const { bola, drill } = await setup();
    await rejects(
      bola.mutation(api.tools.update, {
        toolId: drill,
        name: "Mine now",
        category: "power_tools",
        condition: "good",
        description: "",
      }),
      "FORBIDDEN",
    );
    await rejects(bola.mutation(api.tools.remove, { toolId: drill }), "FORBIDDEN");
  });

  test("the owner can edit and delete their own listing", async () => {
    const { ada, drill } = await setup();
    await ada.mutation(api.tools.update, {
      toolId: drill,
      name: "Cordless drill (18V)",
      category: "power_tools",
      condition: "like_new",
      description: "",
    });
    await ada.mutation(api.tools.remove, { toolId: drill });
    expect(await ada.query(api.tools.mine, {})).toEqual([]);
  });

  test("an admin can remove any listing", async () => {
    const { admin, bola, drill } = await setup();
    await admin.mutation(api.tools.remove, { toolId: drill });
    expect(await bola.query(api.tools.browse, {})).toEqual([]);
  });
});

describe("loan permissions", () => {
  test("only the tool owner can approve, decline or mark returned", async () => {
    const { bola, chidi, drill } = await setup();
    const loanId = await bola.mutation(api.loans.request, {
      toolId: drill,
      startDate: today,
      endDate: addDays(today, 3),
    });
    // The borrower cannot approve their own request...
    await rejects(bola.mutation(api.loans.approve, { loanId }), "FORBIDDEN");
    // ...and neither can an unrelated user.
    await rejects(chidi.mutation(api.loans.approve, { loanId }), "FORBIDDEN");
    await rejects(chidi.mutation(api.loans.decline, { loanId }), "FORBIDDEN");
    await rejects(chidi.mutation(api.loans.markReturned, { loanId }), "FORBIDDEN");
  });

  test("only the borrower can cancel their request", async () => {
    const { ada, bola, chidi, drill } = await setup();
    const loanId = await bola.mutation(api.loans.request, {
      toolId: drill,
      startDate: today,
      endDate: addDays(today, 1),
    });
    await rejects(ada.mutation(api.loans.cancel, { loanId }), "FORBIDDEN");
    await rejects(chidi.mutation(api.loans.cancel, { loanId }), "FORBIDDEN");
    await bola.mutation(api.loans.cancel, { loanId });
  });

  test("nobody can borrow their own tool", async () => {
    const { ada, drill } = await setup();
    await rejects(
      ada.mutation(api.loans.request, { toolId: drill, startDate: today, endDate: today }),
      "FORBIDDEN",
    );
  });

  test("users only see requests that involve them", async () => {
    const { ada, bola, chidi, drill } = await setup();
    await bola.mutation(api.loans.request, { toolId: drill, startDate: today, endDate: today });
    expect(await ada.query(api.loans.incoming, {})).toHaveLength(1);
    expect(await bola.query(api.loans.myRequests, {})).toHaveLength(1);
    expect(await chidi.query(api.loans.incoming, {})).toHaveLength(0);
    expect(await chidi.query(api.loans.myRequests, {})).toHaveLength(0);
  });
});

describe("admin-only functions", () => {
  test("plain users are rejected", async () => {
    const { bola } = await setup();
    const me = (await bola.query(api.users.me, {}))!;
    await rejects(bola.query(api.loans.listForAdmin, {}), "FORBIDDEN");
    await rejects(bola.query(api.users.listForAdmin, {}), "FORBIDDEN");
    await rejects(bola.query(api.automation.overview, {}), "FORBIDDEN");
    await rejects(bola.mutation(api.users.setTrustedLender, { userId: me._id, trusted: true }), "FORBIDDEN");
  });

  test("an admin can mark a trusted lender and it shows on the board", async () => {
    const { ada, admin, bola } = await setup();
    const adaId = (await ada.query(api.users.me, {}))!._id;
    await admin.mutation(api.users.setTrustedLender, { userId: adaId, trusted: true });
    const [tool] = await bola.query(api.tools.browse, {});
    expect(tool.owner).toEqual({ name: "Ada", trustedLender: true });
  });
});
