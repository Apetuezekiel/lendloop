# Requirements checklist

Where each requirement from the brief is met.

## Stack

| Requirement | Where |
|---|---|
| Next.js (App Router) | `app/`, Next 16.4 |
| Clerk for auth | `app/layout.tsx` (ClerkProvider), `components/ConvexClientProvider.tsx`, `proxy.ts` |
| Convex for data and backend logic | `convex/` |
| n8n self-hosted via Docker | `docker-compose.yml`, `n8n/workflows/` |
| TypeScript | everywhere; `pnpm typecheck` |

## Public page

| Requirement | Where |
|---|---|
| Read-only list of available tools, name and category only, from Convex | `app/page.tsx`, `convex/tools.ts` `listPublic` (returns `{ name, category }` only) |
| "Sign in to lend or borrow" button wired to Clerk | `app/page.tsx` (`SignInButton`) |

## Signed-in users

| Requirement | Where |
|---|---|
| List a tool: name, category, condition, short description | `app/(app)/listings/page.tsx`, `tools.create` |
| Request to borrow for a date range | `app/(app)/browse/page.tsx` (RequestDialog), `loans.request` |
| Approve or decline requests on own tools | `app/(app)/incoming/page.tsx`, `loans.approve`, `loans.decline` |
| Mark a loan as returned | `app/(app)/incoming/page.tsx`, `loans.markReturned` |
| All tools with availability, filterable by category | `app/(app)/browse/page.tsx`, `tools.browse` (index `by_listing_category`) |
| My listings / My requests / Incoming requests views | `app/(app)/listings`, `requests`, `incoming` |

## Roles

| Requirement | Where |
|---|---|
| admin: remove any listing | `tools.remove` (admin bypasses owner check), `app/(app)/admin` |
| admin: view all loans | `loans.listForAdmin` (adminQuery) |
| admin: mark Trusted Lender | `users.setTrustedLender` (adminMutation); badge on Browse, loans, admin |
| user: create/edit/delete only own listings | `tools.update` / `tools.remove` with `assertToolOwner` |
| user: act only on requests involving own tools or own borrowing | `assertLender` (approve, decline, return), `assertBorrower` (cancel); views query by caller id |
| RBAC enforced in Convex functions | `convex/lib/auth.ts` builders + asserts; `convex/rbac.test.ts`; README "Authorization" |

## n8n

| Requirement | Where |
|---|---|
| Request notification: Convex calls n8n webhook on create / status change | `convex/lib/outbox.ts`, `convex/automation.ts` `deliver`; `n8n/workflows/1-request-notification.json` |
| Notifies the relevant user (logged mock) using only needed fields | "Compose notification" / "Send notification (mock)" nodes; payload in `automation.buildPayload`; test "the webhook payload carries only what the notification needs" |
| Overdue: scheduled daily workflow fetches overdue loans from a Convex HTTP endpoint | `n8n/workflows/2-overdue-reminders.json` (09:00 cron); `convex/http.ts` `/n8n/overdue-loans` |
| Sends a reminder to each borrower and writes status back | "Send reminder (mock)" + "Write status to LendLoop" → `/n8n/activity` (`reminder_sent` / `reminder_failed`) |

## Integration security and reliability

| Requirement | Where |
|---|---|
| HMAC-signed payloads, verified on the receiving side (both directions) | `convex/lib/hmac.ts`; n8n "Verify signature" node; Convex `signedEndpoint` in `http.ts`; n8n "Sign ..." nodes |
| Secrets in env vars / n8n credentials, never in code or workflow JSON | Convex env vars, `n8n/.env` (gitignored), `$env.*` in workflows; `.env.example`, `n8n/.env.example` |
| Idempotent write-backs | `automation.recordActivity` (key lookup inside a serialisable mutation); keys `notification:<eventId>`, `reminder:<loanId>:<date>`, `workflow_failed:<wf>:<exec>` |
| Retries plus an error workflow; failures visible | Convex delivery backoff + failed state + admin Retry; HTTP node `retryOnFail`; `n8n/workflows/3-error-handler.json` set as `errorWorkflow`; admin "Reported by n8n" |
| Bonus: recent automation activity on each loan | `convex/lib/activity.ts`, `components/domain.tsx` `ActivityList`, shown on every loan card |

## Deliverables

| Requirement | Where |
|---|---|
| Repo with app source | this repo |
| Exported n8n workflow JSON | `n8n/workflows/` |
| README: local setup incl. docker-compose, env vars, architecture, security and data minimisation | `README.md` |
| Note on running it in production | `README.md` "Running it in production" |
