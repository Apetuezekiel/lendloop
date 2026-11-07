"use client";

import { useMutation } from "convex/react";
import { useAppQuery } from "@/components/AppReady";
import { api } from "@/convex/_generated/api";
import { LoanCard } from "@/components/LoanCard";
import { ActionButton, EmptyState, Loading, PageHeader } from "@/components/ui";

export default function IncomingPage() {
  const loans = useAppQuery(api.loans.incoming, {});
  const approve = useMutation(api.loans.approve);
  const decline = useMutation(api.loans.decline);
  const markReturned = useMutation(api.loans.markReturned);

  return (
    <>
      <PageHeader title="Incoming requests" subtitle="Neighbours asking to borrow your tools. Open requests first." />
      {loans === undefined ? (
        <Loading />
      ) : loans.length === 0 ? (
        <EmptyState title="No requests yet">When someone asks to borrow one of your tools, it shows up here.</EmptyState>
      ) : (
        <div className="space-y-3">
          {loans.map((loan) => (
            <LoanCard
              key={loan._id}
              loan={loan}
              counterpartLabel="Requested by"
              actions={
                loan.status === "pending" ? (
                  <>
                    <ActionButton pendingLabel="Approving..." action={() => approve({ loanId: loan._id })}>
                      Approve
                    </ActionButton>
                    <ActionButton variant="secondary" pendingLabel="Declining..." action={() => decline({ loanId: loan._id })}>
                      Decline
                    </ActionButton>
                  </>
                ) : loan.status === "approved" ? (
                  <ActionButton variant="secondary" pendingLabel="Saving..." action={() => markReturned({ loanId: loan._id })}>
                    Mark returned
                  </ActionButton>
                ) : null
              }
            />
          ))}
        </div>
      )}
    </>
  );
}
