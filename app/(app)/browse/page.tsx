"use client";

import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { CATEGORY_LABELS, CONDITION_LABELS, LIMITS, type Category } from "@/convex/lib/constants";
import { CategoryFilter, TrustedBadge } from "@/components/domain";
import { Badge, Button, Card, EmptyState, Field, Loading, Modal, PageHeader, inputClass } from "@/components/ui";
import { errorMessage, localToday } from "@/lib/format";

export default function BrowsePage() {
  const [category, setCategory] = useState<Category | undefined>();
  const tools = useQuery(api.tools.browse, { category });
  const [requesting, setRequesting] = useState<{ id: Id<"tools">; name: string } | null>(null);

  return (
    <>
      <PageHeader title="Browse tools" subtitle="Everything your neighbours are lending, with what is free right now." />
      <CategoryFilter value={category} onChange={setCategory} />
      {tools === undefined ? (
        <Loading />
      ) : tools.length === 0 ? (
        <EmptyState title="No tools here yet">
          {category ? "Try another category." : "List something from My listings to get the loop going."}
        </EmptyState>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {tools.map((tool) => (
            <Card key={tool._id} className="flex flex-col">
              <div className="flex items-start justify-between gap-2">
                <h3 className="font-medium text-stone-900">{tool.name}</h3>
                {tool.availability === "available" ? (
                  <Badge tone="green">Available</Badge>
                ) : (
                  <Badge tone="amber">On loan</Badge>
                )}
              </div>
              <p className="mt-1 text-xs text-stone-500">
                {CATEGORY_LABELS[tool.category]} · {CONDITION_LABELS[tool.condition]}
              </p>
              {tool.description && <p className="mt-2 text-sm text-stone-600">{tool.description}</p>}
              <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-4">
                <span className="flex items-center gap-1.5 text-sm text-stone-600">
                  {tool.isMine ? "Your listing" : tool.owner.name}
                  {tool.owner.trustedLender && <TrustedBadge />}
                </span>
                {!tool.isMine &&
                  (tool.myPendingRequest ? (
                    <span className="text-xs text-stone-500">Request sent</span>
                  ) : (
                    <Button variant="secondary" onClick={() => setRequesting({ id: tool._id, name: tool.name })}>
                      Request
                    </Button>
                  ))}
              </div>
            </Card>
          ))}
        </div>
      )}
      <RequestDialog tool={requesting} onClose={() => setRequesting(null)} />
    </>
  );
}

function RequestDialog({
  tool,
  onClose,
}: {
  tool: { id: Id<"tools">; name: string } | null;
  onClose: () => void;
}) {
  const request = useMutation(api.loans.request);
  const today = localToday();
  const [startDate, setStart] = useState(today);
  const [endDate, setEnd] = useState(today);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!tool) return;
    setPending(true);
    setError(null);
    try {
      await request({ toolId: tool.id, startDate, endDate, note: note || undefined });
      setNote("");
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <Modal open={tool !== null} onClose={onClose} title={`Borrow ${tool?.name ?? ""}`}>
      <form onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="From">
            <input type="date" className={inputClass} min={today} value={startDate} required
              onChange={(e) => { setStart(e.target.value); if (e.target.value > endDate) setEnd(e.target.value); }} />
          </Field>
          <Field label="Until">
            <input type="date" className={inputClass} min={startDate} value={endDate} required
              onChange={(e) => setEnd(e.target.value)} />
          </Field>
        </div>
        <Field label="Note for the owner" hint="Optional. Only the owner sees this.">
          <textarea className={inputClass} rows={2} maxLength={LIMITS.note.max} value={note}
            placeholder="What it's for, when you can pick it up"
            onChange={(e) => setNote(e.target.value)} />
        </Field>
        {error && <p className="text-sm text-red-700">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={pending}>{pending ? "Sending..." : "Send request"}</Button>
        </div>
      </form>
    </Modal>
  );
}
