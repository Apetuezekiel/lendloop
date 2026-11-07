"use client";

import type { ReactNode } from "react";
import type { FunctionReturnType } from "convex/server";
import type { api } from "@/convex/_generated/api";
import { CATEGORY_LABELS } from "@/convex/lib/constants";
import { formatRange } from "@/lib/format";
import { ActivityList, LoanStatusBadge, TrustedBadge } from "./domain";
import { Card } from "./ui";

export type LoanView = FunctionReturnType<typeof api.loans.myRequests>[number];

export function LoanCard({
  loan,
  counterpartLabel,
  actions,
}: {
  loan: LoanView;
  counterpartLabel: string;
  actions?: ReactNode;
}) {
  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-medium text-stone-900">{loan.toolName}</h3>
            <LoanStatusBadge status={loan.status} overdueDays={loan.overdueDays} />
          </div>
          <p className="mt-1 text-sm text-stone-600">
            {formatRange(loan.startDate, loan.endDate)}
            {loan.category && <span className="text-stone-400"> · {CATEGORY_LABELS[loan.category]}</span>}
          </p>
          <p className="mt-1 flex items-center gap-1.5 text-sm text-stone-500">
            {counterpartLabel} {loan.counterpart.name}
            {loan.counterpart.trustedLender && <TrustedBadge />}
          </p>
          {loan.note && <p className="mt-2 rounded-lg bg-stone-50 px-3 py-2 text-sm text-stone-600">&ldquo;{loan.note}&rdquo;</p>}
        </div>
        {actions && <div className="flex flex-wrap items-start gap-2">{actions}</div>}
      </div>
      <ActivityList items={loan.activity} />
    </Card>
  );
}
