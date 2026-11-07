import Link from "next/link";

export function Logo() {
  return (
    <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight text-stone-900">
      <svg viewBox="0 0 24 24" className="size-6 text-emerald-700" aria-hidden fill="none" stroke="currentColor" strokeWidth="2.2">
        <path d="M8 7a5 5 0 1 0 0 10h1" strokeLinecap="round" />
        <path d="M16 17a5 5 0 1 0 0-10h-1" strokeLinecap="round" />
        <path d="M9 12h6" strokeLinecap="round" />
      </svg>
      LendLoop
    </Link>
  );
}
