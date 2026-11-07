"use client";

import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import {
  CATEGORIES,
  CATEGORY_LABELS,
  CONDITIONS,
  CONDITION_LABELS,
  LIMITS,
  type Category,
  type Condition,
} from "@/convex/lib/constants";
import { ActionButton, Badge, Button, Card, EmptyState, Field, Loading, Modal, PageHeader, inputClass } from "@/components/ui";
import { errorMessage } from "@/lib/format";

type Listing = Pick<Doc<"tools">, "_id" | "name" | "category" | "condition" | "description">;

export default function ListingsPage() {
  const tools = useQuery(api.tools.mine);
  const remove = useMutation(api.tools.remove);
  const [editing, setEditing] = useState<Listing | "new" | null>(null);

  return (
    <>
      <PageHeader
        title="My listings"
        subtitle="Tools you lend to neighbours."
        action={<Button onClick={() => setEditing("new")}>List a tool</Button>}
      />
      {tools === undefined ? (
        <Loading />
      ) : tools.length === 0 ? (
        <EmptyState title="You are not lending anything yet">
          That drill in the drawer could save a neighbour a trip to the shop.
        </EmptyState>
      ) : (
        <div className="space-y-3">
          {tools.map((tool) => (
            <Card key={tool._id} className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-medium text-stone-900">{tool.name}</h3>
                  {tool.availability === "on_loan" ? <Badge tone="amber">On loan</Badge> : <Badge tone="green">Available</Badge>}
                  {tool.pendingRequests > 0 && (
                    <Badge tone="blue">{tool.pendingRequests} pending {tool.pendingRequests === 1 ? "request" : "requests"}</Badge>
                  )}
                </div>
                <p className="mt-1 text-xs text-stone-500">
                  {CATEGORY_LABELS[tool.category]} · {CONDITION_LABELS[tool.condition]}
                  {tool.description && ` · ${tool.description}`}
                </p>
              </div>
              <div className="flex items-start gap-2">
                <Button variant="secondary" onClick={() => setEditing(tool)}>Edit</Button>
                <ActionButton
                  variant="danger"
                  pendingLabel="Removing..."
                  disabled={tool.availability === "on_loan"}
                  title={tool.availability === "on_loan" ? "Mark it returned before removing" : undefined}
                  action={async () => {
                    if (confirm(`Remove ${tool.name}? Pending requests will be declined.`)) {
                      await remove({ toolId: tool._id });
                    }
                  }}
                >
                  Remove
                </ActionButton>
              </div>
            </Card>
          ))}
        </div>
      )}
      <ToolFormDialog
        key={editing === null ? "closed" : editing === "new" ? "new" : editing._id}
        listing={editing}
        onClose={() => setEditing(null)}
      />
    </>
  );
}

function ToolFormDialog({ listing, onClose }: { listing: Listing | "new" | null; onClose: () => void }) {
  const create = useMutation(api.tools.create);
  const update = useMutation(api.tools.update);
  const initial = listing && listing !== "new" ? listing : null;
  const [name, setName] = useState(initial?.name ?? "");
  const [category, setCategory] = useState<Category>(initial?.category ?? "power_tools");
  const [condition, setCondition] = useState<Condition>(initial?.condition ?? "good");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      const fields = { name, category, condition, description };
      if (initial) await update({ toolId: initial._id, ...fields });
      else await create(fields);
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <Modal open={listing !== null} onClose={onClose} title={initial ? "Edit listing" : "List a tool"}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Name">
          <input className={inputClass} value={name} required minLength={LIMITS.toolName.min}
            maxLength={LIMITS.toolName.max} placeholder="Cordless drill" onChange={(e) => setName(e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Category">
            <select className={inputClass} value={category} onChange={(e) => setCategory(e.target.value as Category)}>
              {CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
            </select>
          </Field>
          <Field label="Condition">
            <select className={inputClass} value={condition} onChange={(e) => setCondition(e.target.value as Condition)}>
              {CONDITIONS.map((c) => <option key={c} value={c}>{CONDITION_LABELS[c]}</option>)}
            </select>
          </Field>
        </div>
        <Field label="Short description" hint={`${description.length}/${LIMITS.description.max}`}>
          <textarea className={inputClass} rows={3} maxLength={LIMITS.description.max} value={description}
            placeholder="18V, two batteries, comes with a bit set" onChange={(e) => setDescription(e.target.value)} />
        </Field>
        {error && <p className="text-sm text-red-700">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={pending}>{pending ? "Saving..." : initial ? "Save changes" : "List tool"}</Button>
        </div>
      </form>
    </Modal>
  );
}
