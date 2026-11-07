// Modules for convex-test: every Convex function file plus _generated, minus tests.
// import.meta.glob is provided by Vite, which Vitest runs on.
declare global {
  interface ImportMeta {
    glob(patterns: string[]): Record<string, () => Promise<unknown>>;
  }
}

export const modules = import.meta.glob([
  "./**/*.{ts,js}",
  "!./**/*.test.ts",
  "!./**/*.d.ts",
  "!./test.setup.ts",
]);
