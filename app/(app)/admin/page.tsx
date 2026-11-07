"use client";

import { useMutation } from "convex/react";
import { useAppQuery } from "@/components/AppReady";
import { api } from "@/convex/_generated/api";
import { CATEGORY_LABELS } from "@/convex/lib/constants";
import { ActivityList, LoanStatusBadge, TrustedBadge } from "@/components/domain";
import { ActionButton, Badge, Card, EmptyState, Loading, PageHeader } from "@/components/ui";
import { formatRange, timeAgo } from "@/lib/format";
import type { ReactNode } from "react";

// The nav only shows this page to admins, but that is cosmetic: every query
// here is an adminQuery and throws FORBIDDEN for anyone else.

export default function AdminPage() {
  const me = useAppQuery(api.users.me, {});
  if (me === undefined) return <Loading />;
  if (me?.role !== "admin") return <EmptyState title="Admins only">You do not have access to this page.</EmptyState>;
  return (
    <>
      <PageHeader title="Admin" subtitle="Moderate listings, see every loan, and watch the automations." />
      <div className="space-y-10">
        <Automation />
        <Loans />
        <Listings />
        <Members />
      </div>
    </>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-stone-500">{title}</h2>
      {children}
    </section>
  );
}

const table = "w-full text-left text-sm";
const th = "px-4 py-2 font-medium text-stone-500";
const td = "px-4 py-3 align-top";

function Automation() {
  const data = useAppQuery(api.automation.overview, {});
  const retry = useMutation(api.automation.retryEvent);
  if (!data) return <Loading />;
  const failed = data.events.filter((e) => e.status === "failed");
  return (
    <Section title="Automation">
      <div className="grid gap-3 lg:grid-cols-2">
        <Card>
          <h3 className="mb-2 font-medium text-stone-900">Webhook deliveries to n8n</h3>
          {failed.length > 0 && (
            <p className="mb-2 text-sm text-red-700">{failed.length} failed after all retries.</p>
          )}
          <ul className="divide-y divide-stone-100">
            {data.events.slice(0, 10).map((e) => (
              <li key={e._id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <span>
                  <span className="font-mono text-xs text-stone-500">{e.type}</span>{" "}
                  <span className="text-stone-800">{e.toolName}</span>
                  {e.lastError && <span className="block text-xs text-red-700">{e.lastError}</span>}
                </span>
                <span className="flex items-center gap-2">
                  <Badge tone={e.status === "delivered" ? "green" : e.status === "failed" ? "red" : "amber"}>
                    {e.status}
                    {e.attempts > 1 && ` (${e.attempts} tries)`}
                  </Badge>
                  {e.status === "failed" && (
                    <ActionButton variant="secondary" pendingLabel="Retrying..." action={() => retry({ eventId: e._id })}>
                      Retry
                    </ActionButton>
                  )}
                </span>
              </li>
            ))}
            {data.events.length === 0 && <li className="py-2 text-sm text-stone-500">No events yet.</li>}
          </ul>
        </Card>
        <Card>
          <h3 className="mb-2 font-medium text-stone-900">Reported by n8n</h3>
          <ul className="divide-y divide-stone-100">
            {data.activity.slice(0, 10).map((a) => (
              <li key={a._id} className="py-2 text-sm">
                <span className="flex items-center gap-2">
                  {a.kind === "workflow_failed" || a.kind === "reminder_failed" ? (
                    <Badge tone="red">{a.kind}</Badge>
                  ) : (
                    <Badge tone="green">{a.kind}</Badge>
                  )}
                  <span className="text-xs text-stone-500">{timeAgo(a._creationTime)}</span>
                </span>
                <span className="mt-1 block text-stone-700">{a.summary}</span>
                <span className="block text-xs text-stone-500">
                  {a.workflow}
                  {a.executionId && ` · execution ${a.executionId}`}
                </span>
              </li>
            ))}
            {data.activity.length === 0 && <li className="py-2 text-sm text-stone-500">Nothing reported yet.</li>}
          </ul>
        </Card>
      </div>
    </Section>
  );
}

function Loans() {
  const loans = useAppQuery(api.loans.listForAdmin, {});
  if (!loans) return <Loading />;
  return (
    <Section title={`All loans (${loans.length})`}>
      <Card className="overflow-x-auto p-0">
        <table className={table}>
          <thead className="border-b border-stone-100">
            <tr><th className={th}>Tool</th><th className={th}>Lender</th><th className={th}>Borrower</th><th className={th}>Dates</th><th className={th}>Status</th></tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {loans.map((loan) => (
              <tr key={loan._id}>
                <td className={td}>
                  <span className="font-medium text-stone-900">{loan.toolName}</span>
                  <ActivityList items={loan.activity} />
                </td>
                <td className={td}>{loan.lender}</td>
                <td className={td}>{loan.borrower}</td>
                <td className={`${td} whitespace-nowrap`}>{formatRange(loan.startDate, loan.endDate)}</td>
                <td className={td}><LoanStatusBadge status={loan.status} overdueDays={loan.overdueDays} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        {loans.length === 0 && <p className="px-4 py-6 text-sm text-stone-500">No loans yet.</p>}
      </Card>
    </Section>
  );
}

function Listings() {
  const tools = useAppQuery(api.tools.listForAdmin, {});
  const remove = useMutation(api.tools.remove);
  if (!tools) return <Loading />;
  return (
    <Section title={`Listings (${tools.length})`}>
      <Card className="overflow-x-auto p-0">
        <table className={table}>
          <thead className="border-b border-stone-100">
            <tr><th className={th}>Tool</th><th className={th}>Owner</th><th className={th}>Status</th><th className={th} /></tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {tools.map((tool) => (
              <tr key={tool._id}>
                <td className={td}>
                  <span className="font-medium text-stone-900">{tool.name}</span>
                  <span className="block text-xs text-stone-500">{CATEGORY_LABELS[tool.category]}</span>
                </td>
                <td className={td}>
                  {tool.owner.name}
                  <span className="block text-xs text-stone-500">{tool.owner.email}</span>
                </td>
                <td className={td}>
                  <Badge tone={tool.availability === "available" ? "green" : "amber"}>
                    {tool.availability === "available" ? "Available" : "On loan"}
                  </Badge>
                </td>
                <td className={`${td} text-right`}>
                  <ActionButton
                    variant="danger"
                    pendingLabel="Removing..."
                    action={async () => {
                      if (confirm(`Remove ${tool.name} from the board?`)) await remove({ toolId: tool._id });
                    }}
                  >
                    Remove
                  </ActionButton>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </Section>
  );
}

function Members() {
  const users = useAppQuery(api.users.listForAdmin, {});
  const setTrusted = useMutation(api.users.setTrustedLender);
  if (!users) return <Loading />;
  return (
    <Section title={`Members (${users.length})`}>
      <Card className="overflow-x-auto p-0">
        <table className={table}>
          <thead className="border-b border-stone-100">
            <tr><th className={th}>Member</th><th className={th}>Role</th><th className={th}>Listings</th><th className={th} /></tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {users.map((u) => (
              <tr key={u._id}>
                <td className={td}>
                  <span className="flex items-center gap-1.5 font-medium text-stone-900">
                    {u.name} {u.trustedLender && <TrustedBadge />}
                  </span>
                  <span className="block text-xs text-stone-500">{u.email}</span>
                </td>
                <td className={td}>{u.role === "admin" ? <Badge tone="blue">admin</Badge> : <Badge>user</Badge>}</td>
                <td className={td}>{u.listings}</td>
                <td className={`${td} text-right`}>
                  <ActionButton
                    variant="secondary"
                    pendingLabel="Saving..."
                    action={() => setTrusted({ userId: u._id, trusted: !u.trustedLender })}
                  >
                    {u.trustedLender ? "Remove trusted" : "Mark trusted lender"}
                  </ActionButton>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </Section>
  );
}
