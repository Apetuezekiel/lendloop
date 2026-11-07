import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { modules } from "./test.setup";
import { addDays, utcDate } from "./lib/dates";

const today = utcDate(Date.now());

async function setup() {
  const t = convexTest(schema, modules);
  const ada = t.withIdentity({ tokenIdentifier: "clerk|ada", name: "Ada Obi", email: "ada@example.com" });
  const bola = t.withIdentity({ tokenIdentifier: "clerk|bola", name: "Bola Ade", email: "bola@example.com" });
  const chidi = t.withIdentity({ tokenIdentifier: "clerk|chidi", name: "Chidi Eze", email: "chidi@example.com" });
  for (const who of [ada, bola, chidi]) await who.mutation(api.users.ensure, {});
  const drill = await ada.mutation(api.tools.create, {
    name: "Cordless drill",
    category: "power_tools",
    condition: "good",
    description: "",
  });
  return { t, ada, bola, chidi, drill };
}

describe("loan lifecycle", () => {
  test("approve puts the tool on loan, returned frees it", async () => {
    const { t, ada, bola, chidi, drill } = await setup();
    const first = await bola.mutation(api.loans.request, { toolId: drill, startDate: today, endDate: addDays(today, 2) });
    const second = await chidi.mutation(api.loans.request, { toolId: drill, startDate: today, endDate: addDays(today, 2) });

    await ada.mutation(api.loans.approve, { loanId: first });
    expect(await t.query(api.tools.listPublic, {})).toEqual([]);
    const [onLoan] = await chidi.query(api.tools.browse, {});
    expect(onLoan.availability).toBe("on_loan");

    // A second approval while the tool is out is refused.
    await expect(ada.mutation(api.loans.approve, { loanId: second })).rejects.toMatchObject({
      data: expect.objectContaining({ code: "CONFLICT" }),
    });

    await ada.mutation(api.loans.markReturned, { loanId: first });
    expect(await t.query(api.tools.listPublic, {})).toHaveLength(1);
    await ada.mutation(api.loans.approve, { loanId: second });
  });

  test("each state change queues one notification for the right person", async () => {
    const { t, ada, bola, drill } = await setup();
    const loanId = await bola.mutation(api.loans.request, { toolId: drill, startDate: today, endDate: today });
    await ada.mutation(api.loans.approve, { loanId });
    await ada.mutation(api.loans.markReturned, { loanId });

    const events = await t.run((ctx) => ctx.db.query("automationEvents").collect());
    const users = await t.run((ctx) => ctx.db.query("users").collect());
    const nameOf = (id: string) => users.find((u) => u._id === id)?.name;
    expect(events.map((e) => [e.type, nameOf(e.recipientId), e.status])).toEqual([
      ["loan.requested", "Ada", "pending"],
      ["loan.approved", "Bola", "pending"],
      ["loan.returned", "Bola", "pending"],
    ]);
  });

  test("the webhook payload carries only what the notification needs", async () => {
    const { t, bola, drill } = await setup();
    await bola.mutation(api.loans.request, {
      toolId: drill,
      startDate: today,
      endDate: today,
      note: "Private note for the lender",
    });
    const [event] = await t.run((ctx) => ctx.db.query("automationEvents").collect());
    const payload = await t.query(internal.automation.buildPayload, { eventId: event._id });
    expect(Object.keys(payload!).sort()).toEqual(["eventId", "loan", "occurredAt", "recipient", "type"]);
    expect(Object.keys(payload!.loan).sort()).toEqual(["endDate", "id", "startDate", "toolName"]);
    expect(payload!.recipient).toMatchObject({ firstName: "Ada", email: "ada@example.com", role: "lender" });
    expect(JSON.stringify(payload)).not.toContain("Private note");
    expect(JSON.stringify(payload)).not.toContain("bola@example.com");
  });

  test("validates dates and duplicate requests", async () => {
    const { bola, drill } = await setup();
    const bad = (startDate: string, endDate: string) =>
      expect(bola.mutation(api.loans.request, { toolId: drill, startDate, endDate })).rejects.toMatchObject({
        data: expect.objectContaining({ code: "INVALID" }),
      });
    await bad("2020-01-01", "2020-01-02");
    await bad(today, addDays(today, -1));
    await bad(today, addDays(today, 31));
    await bad("2026-02-30", "2026-03-01");

    await bola.mutation(api.loans.request, { toolId: drill, startDate: today, endDate: today });
    await expect(
      bola.mutation(api.loans.request, { toolId: drill, startDate: today, endDate: today }),
    ).rejects.toMatchObject({ data: expect.objectContaining({ code: "CONFLICT" }) });
  });
});

describe("automation write-backs", () => {
  test("recordActivity is idempotent on its key", async () => {
    const { t, bola, drill } = await setup();
    const loanId = await bola.mutation(api.loans.request, { toolId: drill, startDate: today, endDate: today });
    const write = {
      idempotencyKey: `notification:evt_1`,
      kind: "notification_sent" as const,
      loanId,
      summary: "Lender notified about a new request",
      workflow: "LendLoop request notification",
      executionId: "42",
    };
    expect(await t.mutation(internal.automation.recordActivity, write)).toEqual({ status: "created" });
    expect(await t.mutation(internal.automation.recordActivity, write)).toEqual({ status: "duplicate" });
    const rows = await t.run((ctx) => ctx.db.query("automationActivity").collect());
    expect(rows).toHaveLength(1);
  });

  test("overdue list skips loans already reminded today", async () => {
    const { t, ada, bola, drill } = await setup();
    const loanId = await bola.mutation(api.loans.request, { toolId: drill, startDate: today, endDate: today });
    await ada.mutation(api.loans.approve, { loanId });
    // Backdate the due date so the loan is overdue.
    await t.run((ctx) => ctx.db.patch(loanId, { endDate: addDays(today, -2) }));

    const first = await t.query(internal.automation.overdueLoans, {});
    expect(first.loans).toHaveLength(1);
    expect(first.loans[0]).toMatchObject({ toolName: "Cordless drill", daysOverdue: 2 });
    expect(first.loans[0].borrower).toEqual({ firstName: "Bola", email: "bola@example.com" });

    await t.mutation(internal.automation.recordActivity, {
      idempotencyKey: first.loans[0].idempotencyKey,
      kind: "reminder_sent",
      loanId,
      summary: "Overdue reminder sent",
      workflow: "LendLoop overdue reminders",
    });
    expect((await t.query(internal.automation.overdueLoans, {})).loans).toHaveLength(0);

    const [view] = await bola.query(api.loans.myRequests, {});
    expect(view.overdueDays).toBe(2);
    expect(view.activity[0]).toMatchObject({ label: "Overdue reminder sent", tone: "ok" });
  });
});
