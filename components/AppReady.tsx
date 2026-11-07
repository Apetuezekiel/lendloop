"use client";

import { useQuery } from "convex/react";
import type { FunctionArgs, FunctionReference, FunctionReturnType } from "convex/server";
import { createContext, useContext } from "react";

// True once the signed-in user has a Convex `users` row (see app/(app)/layout).
// Pages always render; their queries wait on this instead of the layout
// swapping the page out, which keeps every route segment in the tree.
const AppReadyContext = createContext(false);
export const AppReadyProvider = AppReadyContext.Provider;

export function useAppQuery<Q extends FunctionReference<"query">>(
  query: Q,
  args: FunctionArgs<Q>,
): FunctionReturnType<Q> | undefined {
  const ready = useContext(AppReadyContext);
  // Cast: useQuery's variadic signature does not narrow through a generic.
  return useQuery(query as FunctionReference<"query">, ready ? args : "skip") as
    | FunctionReturnType<Q>
    | undefined;
}
