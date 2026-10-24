# VTA Talent Cloud

A role-based automotive skills and workforce platform. One backend and one database serve four portals: **Learner**, **Employer**, **Training Partner** (including trainers) and **Admin**. A public website follows in Phase 8.

**This is Phase 1: the shared foundation and the Admin Portal.** Every feature here is new (status *Proposed MVP*). Nothing has been checked against an existing VTA system.

## What works in Phase 1

| Area | What you can do |
| --- | --- |
| Sign-in | Staff, employers and partners sign in with email and password. Learners and trainers sign in with a 6-digit code sent to their phone. After sign-in, each person lands in their own portal. |
| Access control | Every API route names a permission, and the app refuses to start if a route forgets one. Records outside a user's organisation or centre return "not found". |
| Admin: users | Invite (email link or phone sign-in), approve, suspend, reactivate and deactivate users. Give and remove roles with the right scope. |
| Admin: organisations | Add employers and training partners. Verify them, reject them, or ask for more information. |
| Admin: centres | Add, edit, deactivate and search centres. Each centre is run by VTA or by a training partner. |
| Audit log | Every sensitive action records who did it, what changed, the time and the request ID. The database blocks edits and deletes. |
| Other portals | Learner, Employer and Training Partner each show a branded home and what is coming next. This proves routing and roles end to end. |

## Run it locally

You need **Node.js 22+**, **pnpm 10+** and **Docker** (for PostgreSQL). No paid accounts or API keys are needed.

```bash
cp .env.example .env
docker compose -f infra/docker-compose.yml up -d   # PostgreSQL 16 (+ Mailpit for later)
pnpm install
pnpm db:migrate
pnpm db:seed          # prints demo sign-ins and saves them to apps/api/.seed-credentials.txt
pnpm dev              # API on :3000, web app on http://localhost:5173
```

To start fresh at any time: `pnpm db:reset` (drops everything, migrates, re-seeds with new passwords).

### Demo sign-ins

`pnpm db:seed` creates one user per role in invented organisations. Passwords are generated fresh on every run and are never committed.

| Role | Sign in with | Lands in |
| --- | --- | --- |
| Super Admin | superadmin@demo.vta.local | Admin Portal |
| Operations Admin | ops@demo.vta.local | Admin Portal |
| Centre Admin | centre@demo.vta.local | Admin Portal (own centre only) |
| Employer Admin (A and B) | employer-a@ / employer-b@demo.vta.local | Employer Portal |
| Recruiter | recruiter-a@demo.vta.local | Employer Portal |
| Partner Admin (A and B) | partner-a@ / partner-b@demo.vta.local | Training Partner Portal |
| Partner Viewer | viewer-a@demo.vta.local | Training Partner Portal |
| Trainer | phone 99000 00101 | Training Partner Portal |
| Learner | phone 99000 00201 | Learner Portal |
| Two roles | multi@demo.vta.local | Portal chooser |

**Phone sign-in during development:** there is no SMS provider yet, so the code prints in the API console (`[DEV SMS] OTP code: 123456`). Invitation links appear the same way and in the Invite dialog. Both stubs refuse to run when `NODE_ENV=production`.

## Tests

```bash
pnpm test        # 72 tests: API (real PostgreSQL), shared rules
pnpm lint
pnpm typecheck
pnpm build
```

Tests use the database in `TEST_DATABASE_URL` (`vta_test`) and reset it for each file. The suite includes the six Phase 1 acceptance tests:

1. Each role signs in and reaches only its own portal — `test/auth.test.ts`
2. Suspending a user signs them out on their next request — `test/lifecycle.test.ts`
3. Employer or partner A gets "not found" for every B record by ID, list filter and request body — `test/isolation.test.ts`
4. Every API route declares a permission (the build fails otherwise) — `test/platform.test.ts`
5. Phone codes expire after 5 minutes, allow 5 attempts and need 60 seconds between requests — `test/auth.test.ts`
6. Audit rows are written for sensitive actions and cannot be changed — `test/platform.test.ts`

## How it is built

```
apps/api          Fastify API, PostgreSQL via Kysely, SQL migrations, seed
  src/policy      The only place access is decided (permissions + record scope)
  src/routes      auth, admin/*, shared scoped reads, health
  src/audit       Append-only audit writer
  test            API, isolation and platform tests
apps/web          React + Vite + Tailwind; one app, four portals
packages/shared   Roles, permissions, Zod schemas used by both sides
infra             Docker Compose for local services
```

- **API:** `/api/v1`, JSON, consistent error shape `{ error: { code, message, fields, requestId } }`, server-side pagination (max 100 a page).
- **Sessions:** random token in an httpOnly, SameSite=Lax cookie, stored hashed. Idle timeout is 12 hours for staff and 30 days for learners, trainers and partners. Writes need the `x-csrf-token` header from `/auth/me`.
- **Passwords:** Argon2id, at least 10 characters, common passwords refused. Five failures lock the account for 15 minutes. Sign-in and OTP endpoints are also rate-limited per IP.
- **Logs:** cookies, CSRF tokens, passwords, codes and token hashes are never logged or audited.

### Changes from the plan

- **Kysely instead of Prisma.** Prisma needs a separately downloaded engine binary. Kysely is plain TypeScript with plain SQL migrations, which are easier to review. It also let the audit table be locked with a database trigger.
- **React Router instead of TanStack Router.** It is more widely known, which makes handover easier. Admin screens load as a separate bundle, so phone users never download them.

## Known limits of Phase 1

- No SMS or email provider: console stubs only (decision D10). Production start is refused until one is configured.
- No password reset yet. It needs an email provider, so it comes with the email work.
- Browser end-to-end tests were run with a headless Chromium script during development but are not yet in CI. A Playwright suite is the first item for Phase 2.
- The wordmark is plain text. Swap `Wordmark` in `apps/web/src/components/ui.tsx` for the VTA master logo once supplied.
- The PWA manifest and service worker arrive with the Training Partner and Learner phases (4 and 5).
- Not yet deployed. Hosting is decision D10.

## Defaults assumed (change any of these before Phase 2)

- **D1:** a new standalone app, not an extension of an existing VTA LMS.
- **D2:** email and password for staff, employers and partners; phone OTP for learners and trainers.
- **D4:** users must be 18 or older during the pilot. Date of birth is collected from Phase 5.
