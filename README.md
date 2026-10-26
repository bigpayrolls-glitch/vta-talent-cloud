# VTA Talent Cloud

A role-based automotive skills and workforce platform. One backend and one database serve four portals: **Learner**, **Employer**, **Training Partner** (including trainers) and **Admin**. A public website follows in Phase 8.

**Built so far: Phase 1 (shared foundation and Admin Portal) and Phase 2 (training master data).** Every feature here is new (status *Proposed MVP*). Nothing has been checked against an existing VTA system.

## What works in Phase 2

| Area | What you can do |
| --- | --- |
| Courses (T-01) | Create courses with skill area, level, delivery mode, duration, prerequisites, an attendance threshold, a pass mark and assessment criteria (marks, required or not). Criteria and pass rules lock once a batch of the course starts. |
| Trainers (T-02) | Add trainers by mobile number at a centre; their organisation is whoever runs that centre (a partner, or VTA). Assign more centres, record specialisations, verify, reject or ask for more information. Only verified trainers can be given batches. |
| Candidates (T-03) | Add candidates (18+, decision D4) or import a CSV of up to 500 rows: every row is checked first, then only valid rows are imported. Each gets a candidate ID such as VTA2600042. Same name and date of birth is flagged as a possible duplicate, which must be reviewed before the profile can be verified or enrolled. Verify, reject or ask for a correction, with reasons; edits keep before and after values. |
| Batches (T-04) | Create a batch from a course, centre, verified trainer, dates and capacity. Enrol candidates (all or nothing, capacity checked), withdraw with a reason, re-enrol, start, complete or cancel. Centre admins manage batches at their own centre only. |
| Search (T-05) | Candidate, batch, course and trainer lists are searched, filtered and paged on the server (100 a page at most). |
| Documents (T-06) | Upload PDF, JPG or PNG files up to 10 MB to a candidate. The real file type is checked from its content. Files are private: each download uses a link that works for 5 minutes, and every link handed out is audited. |
| Training Partner portal | Partner admins and viewers see batches at their centres; trainers see only their own batches. Rosters show phone numbers to the batch trainer and VTA staff only. |
| Dashboard | Candidates, batches, enrolments and courses, plus a list of things to verify or review. |

## What works in Phase 1

| Area | What you can do |
| --- | --- |
| Sign-in | Staff, employers and partners sign in with email and password. Learners and trainers sign in with a 6-digit code sent to their phone. After sign-in, each person lands in their own portal. |
| Access control | Every API route names a permission, and the app refuses to start if a route forgets one. Records outside a user's organisation or centre return "not found". |
| Admin: users | Invite (email link or phone sign-in), approve, suspend, reactivate and deactivate users. Give and remove roles with the right scope. |
| Admin: organisations | Add employers and training partners. Verify them, reject them, or ask for more information. |
| Admin: centres | Add, edit, deactivate and search centres. Each centre is run by VTA or by a training partner. |
| Audit log | Every sensitive action records who did it, what changed, the time and the request ID. The database blocks edits and deletes. |
| Other portals | Learner and Employer each show a branded home and what is coming next. |

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
| Trainer (Partner A centre) | phone 99000 00101 | Training Partner Portal |
| Trainer (VTA centre) | phone 99000 00102 | Training Partner Portal |
| Trainer (Partner B centre) | phone 99000 00103 | Training Partner Portal |
| Trainer, not yet verified | phone 99000 00104 | Training Partner Portal |
| Learner | phone 99000 00201 | Learner Portal |
| Two roles | multi@demo.vta.local | Portal chooser |

The demo data also has three courses (2W, 4W and EV), nine candidates (one flagged as a possible duplicate) and three batches at three different centres.

**Phone sign-in during development:** there is no SMS provider yet, so the code prints in the API console (`[DEV SMS] OTP code: 123456`). Invitation links appear the same way and in the Invite dialog. Both stubs refuse to run when `NODE_ENV=production`.

## Tests

```bash
pnpm test        # 131 tests: API (real PostgreSQL) and shared rules
pnpm e2e         # 16 browser tests (Playwright): desktop and phone sizes
pnpm lint
pnpm typecheck
pnpm build
```

API tests use the database in `TEST_DATABASE_URL` (`vta_test`) and reset it for each file. Browser tests reset `vta_e2e`, start their own API (port 3100) and web app (port 5174), and drive Chromium through real journeys: sign-in by email and phone, course to batch to enrolment, CSV import, document upload and download, what a partner and a trainer can see, and phone-size layout. First time on a new machine: `pnpm --filter @vta/e2e exec playwright install chromium`.

Phase 2 isolation tests (`test/isolation2.test.ts`) check that partners see only their centres' batches, trainers only their own batches, centre admins only their centre, and nobody outside VTA staff reads candidate records. Breaking the batch access check on purpose makes five of them fail.

The suite includes the six Phase 1 acceptance tests:

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
  src/routes      auth, admin/*, training/* (courses, trainers, candidates, batches, files), health
  src/lib         storage (private files, signed links), csv, crypto
  src/audit       Append-only audit writer
  test            API, isolation and platform tests
apps/web          React + Vite + Tailwind; one app, four portals
packages/shared   Roles, permissions, Zod schemas used by both sides
e2e               Playwright browser tests
infra             Docker Compose for local services
```

- **API:** `/api/v1`, JSON, consistent error shape `{ error: { code, message, fields, requestId } }`, server-side pagination (max 100 a page).
- **Sessions:** random token in an httpOnly, SameSite=Lax cookie, stored hashed. Idle timeout is 12 hours for staff and 30 days for learners, trainers and partners. Writes need the `x-csrf-token` header from `/auth/me`.
- **Passwords:** Argon2id, at least 10 characters, common passwords refused. Five failures lock the account for 15 minutes. Sign-in and OTP endpoints are also rate-limited per IP.
- **Logs:** cookies, CSRF tokens, passwords, codes and token hashes are never logged or audited.

### Changes from the plan

- **Kysely instead of Prisma.** Prisma needs a separately downloaded engine binary. Kysely is plain TypeScript with plain SQL migrations, which are easier to review. It also let the audit table be locked with a database trigger.
- **React Router instead of TanStack Router.** It is more widely known, which makes handover easier. Admin screens load as a separate bundle, so phone users never download them.

## Known limits

- No SMS or email provider: console stubs only (decision D10). Production start is refused until one is configured.
- Uploaded files are stored on the API server's disk (`STORAGE_DIR`). An S3-compatible driver comes with the hosting decision (D10); the interface is ready for it.
- Files are not virus-scanned yet and are labelled "not scanned" (D10).
- No password reset yet. It needs an email provider, so it comes with the email work.
- Candidates added by admins or imported have not yet seen a privacy notice. The notice and consent screens come with the Learner portal (Phase 5); until then candidate data should be limited to the pilot.
- Partner admins cannot create batches yet. That arrives with programmes in Phase 7 (design decision of 24 Oct 2026).
- The wordmark is plain text. Swap `Wordmark` in `apps/web/src/components/ui.tsx` for the VTA master logo once supplied.
- The PWA manifest and service worker arrive with offline attendance and the Learner portal (Phases 4 and 5).
- Not yet deployed. Hosting is decision D10.

## Defaults assumed (change any of these at any time)

- **D1:** a new standalone app, not an extension of an existing VTA LMS.
- **D2:** email and password for staff, employers and partners; phone OTP for learners and trainers.
- **D4:** candidates must be 18 or older during the pilot. Date of birth is required when a candidate is added.
- **D5:** candidates are added by VTA admins or by CSV import for now; self-registration comes with the Learner portal (Phase 5).
- **Uploads:** PDF, JPG and PNG up to 10 MB.
- **Enrolment:** pending or verified candidates can be enrolled; rejected profiles, profiles needing correction and unreviewed possible duplicates cannot.
