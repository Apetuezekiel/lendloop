"use client";

import { useMutation } from "convex/react";
import { useAppQuery } from "@/components/AppReady";
import { api } from "@/convex/_generated/api";
import { LoanCard } from "@/components/LoanCard";
import { ActionButton, EmptyState, Loading, PageHeader } from "@/components/ui";

export default function MyRequestsPage() {
  const loans = useAppQuery(api.loans.myRequests, {});
  const cancel = useMutation(api.loans.cancel);

  return (
    <>
      <PageHeader title="My requests" subtitle="Things you asked to borrow." />
      {loans === undefined ? (
        <Loading />
      ) : loans.length === 0 ? (
        <EmptyState title="No requests yet">Find something on the Browse tab.</EmptyState>
      ) : (
        <div className="space-y-3">
          {loans.map((loan) => (
            <LoanCard
              key={loan._id}
              loan={loan}
              counterpartLabel="Lent by"
              actions={
                loan.status === "pending" && (
                  <ActionButton variant="secondary" pendingLabel="Cancelling..." action={() => cancel({ loanId: loan._id })}>
                    Cancel request
                  </ActionButton>
                )
              }
            />
          ))}
        </div>
      )}
    </>
  );
}
