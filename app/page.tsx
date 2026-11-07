"use client";

import Link from "next/link";
import { SignInButton } from "@clerk/nextjs";
import { Authenticated, AuthLoading, Unauthenticated, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { CATEGORY_LABELS } from "@/convex/lib/constants";
import { Logo } from "@/components/Logo";

export default function PublicBoard() {
  const tools = useQuery(api.tools.listPublic);

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-10 sm:py-16">
      <header className="flex items-center justify-between">
        <Logo />
        <AuthLoading>
          <span className="h-8 w-40" />
        </AuthLoading>
        <Unauthenticated>
          <SignInButton mode="modal" forceRedirectUrl="/browse">
            <button className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white transition-colors duration-150 ease-out hover:bg-emerald-800">
              Sign in to lend or borrow
            </button>
          </SignInButton>
        </Unauthenticated>
        <Authenticated>
          <Link
            href="/browse"
            className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white transition-colors duration-150 ease-out hover:bg-emerald-800"
          >
            Open the board
          </Link>
        </Authenticated>
      </header>

      <section className="mt-14 sm:mt-20">
        <h1 className="max-w-xl text-4xl font-semibold tracking-tight text-stone-900 sm:text-5xl">
          Borrow what you need. Lend what you don&apos;t.
        </h1>
        <p className="mt-4 max-w-lg text-stone-600">
          A tool-lending board for your street. List the drill that sits in a drawer all year, borrow
          the ladder you need once, and get reminders so things come back.
        </p>
      </section>

      <section className="mt-12" aria-labelledby="available-heading">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 id="available-heading" className="text-sm font-semibold uppercase tracking-wide text-stone-500">
            Available now
          </h2>
          {tools && <span className="text-sm text-stone-500">{tools.length} tools</span>}
        </div>
        {tools === undefined ? (
          <div className="h-40 animate-pulse rounded-xl bg-stone-200/60" />
        ) : tools.length === 0 ? (
          <p className="rounded-xl border border-dashed border-stone-300 px-6 py-10 text-center text-stone-500">
            Nothing listed yet. Be the first to lend something.
          </p>
        ) : (
          <ul className="divide-y divide-stone-100 overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-stone-200">
            {tools.map((tool, i) => (
              <li key={i} className="flex items-center justify-between px-4 py-3">
                <span className="font-medium text-stone-900">{tool.name}</span>
                <span className="text-sm text-stone-500">{CATEGORY_LABELS[tool.category]}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-xs text-stone-500">
          Owners stay private until you sign in.
        </p>
      </section>
    </div>
  );
}
