"use client";

import { CATEGORIES, CATEGORY_LABELS, type Category, type LoanStatus } from "@/convex/lib/constants";
import { timeAgo } from "@/lib/format";
import { Badge } from "./ui";

export function CategoryFilter({
  value,
  onChange,
}: {
  value: Category | undefined;
  onChange: (value: Category | undefined) => void;
}) {
  const chip = (active: boolean) =>
    `rounded-lg px-3 py-1.5 text-sm transition-colors duration-150 ease-out ${
      active ? "bg-stone-900 text-white" : "bg-white text-stone-700 ring-1 ring-stone-200 hover:bg-stone-100"
    }`;
  return (
    <div className="mb-5 flex flex-wrap gap-2" role="group" aria-label="Filter by category">
      <button className={chip(value === undefined)} onClick={() => onChange(undefined)} aria-pressed={value === undefined}>
        All
      </button>
      {CATEGORIES.map((c) => (
        <button key={c} className={chip(value === c)} onClick={() => onChange(c)} aria-pressed={value === c}>
          {CATEGORY_LABELS[c]}
        </button>
      ))}
    </div>
  );
}

export function TrustedBadge() {
  return (
    <Badge tone="blue">
      <svg viewBox="0 0 16 16" className="size-3" aria-hidden fill="currentColor">
        <path d="M8 1.5 2.5 3.5v4c0 3.3 2.3 6.1 5.5 7 3.2-.9 5.5-3.7 5.5-7v-4L8 1.5Zm-1 9.6L4.6 8.7l1-1L7 9.1l3.4-3.4 1 1L7 11.1Z" />
      </svg>
      Trusted lender
    </Badge>
  );
}

const STATUS: Record<LoanStatus, { label: string; tone: "neutral" | "green" | "amber" | "red" | "blue" }> = {
  pending: { label: "Awaiting reply", tone: "amber" },
  approved: { label: "On loan", tone: "green" },
  declined: { label: "Declined", tone: "neutral" },
  cancelled: { label: "Cancelled", tone: "neutral" },
  returned: { label: "Returned", tone: "neutral" },
};

export function LoanStatusBadge({ status, overdueDays }: { status: LoanStatus; overdueDays: number }) {
  if (overdueDays > 0) {
    return <Badge tone="red">Overdue {overdueDays === 1 ? "1 day" : `${overdueDays} days`}</Badge>;
  }
  const s = STATUS[status];
  return <Badge tone={s.tone}>{s.label}</Badge>;
}

type ActivityItem = { label: string; at: number; tone: "ok" | "pending" | "error" };

const DOT = { ok: "bg-emerald-500", pending: "bg-amber-400", error: "bg-red-500" };

/** "Reminder sent 2 days ago": what the automations did for this loan. */
export function ActivityList({ items }: { items: ActivityItem[] }) {
  if (items.length === 0) return null;
  return (
    <ul className="mt-3 space-y-1 border-t border-stone-100 pt-3" aria-label="Automation activity">
      {items.map((item, i) => (
        <li key={i} className="flex items-center gap-2 text-xs text-stone-500">
          <span className={`size-1.5 shrink-0 rounded-full ${DOT[item.tone]}`} aria-hidden />
          <span className="text-stone-700">{item.label}</span>
          <span>{timeAgo(item.at)}</span>
        </li>
      ))}
    </ul>
  );
}
