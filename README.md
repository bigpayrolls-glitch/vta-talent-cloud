# VTA Talent Cloud

A role-based automotive skills and workforce platform. One backend and one database serve four portals: **Learner**, **Employer**, **Training Partner** (including trainers) and **Admin**, plus a public front page.

**Built so far: Phase 1 (foundation and Admin Portal), Phase 2 (training master data), Phase 3 (training operations), Phase 4 (offline attendance and the installable app), Phase 5 (Learner portal), Phase 6 (Employer portal and hiring), Phase 7 (partner programmes and reports), Phase 8 (public site and organisation sign-up), Phase 9 (notifications and account self-service), Phase 10 (pilot readiness) and Phase 11 (account administration).** Every feature here is new (status *Proposed MVP*). Nothing has been checked against an existing VTA system.

## Phase 11: account administration

| Area | What you can do |
| --- | --- |
| Change a sign-in mobile number | Operations and Super Admins change the number a learner or trainer signs in with, from the candidate, trainer or user page, recording how they checked who it is. The person is signed out everywhere, codes for the old number stop working, they are notified in the app, and the audit log keeps both numbers masked. A number another account uses is refused. |
| Partner team (PA-07) | Partner admins invite viewers by email (read-only access to the organisation's programmes, beneficiaries, reports and documents) and remove them; access ends at once. They cannot remove themselves or another admin. Invitations and removals are in the audit log. |

## Phase 10: pilot readiness

| Area | What was done |
| --- | --- |
| Requirements check | [docs/traceability.md](docs/traceability.md) maps every requirement ID to its status, code and tests (now 52 of 61 built, 6 partial, 2 not built, 1 waiting for a vendor), plus the non-functional requirements, acceptance criteria and the decisions VTA still needs to make. A reviewer that had not written the code drafted it; the gaps it found were fixed below. |
| Accessibility (WCAG 2.2 AA) | Automated checks (axe-core) on 40 screens across every portal, with dialogs and menus open and form errors showing, plus keyboard-only sign-in. Fixed: the logo's label, low-contrast text on the sign-in page, and the account menu's structure for screen readers. A manual screen-reader check is still recommended. |
| Security | The web app now sends a strict Content Security Policy (own scripts only, no eval, no framing) and other security headers, defined once in `apps/web/security-headers.json`; browser tests run under it and fail on any violation. See [SECURITY.md](SECURITY.md). Dependabot opens weekly dependency updates. |
| Performance | `pnpm --filter @vta/api perf` loads pilot-scale data and times 17 common read APIs: slowest p95 69 ms at 10,000 learners, 402 ms at 50,000 (target 2.5 s). |
| Operations | A daily maintenance job (old codes, sessions and reset links; sign-ups never confirmed in 30 days are closed, and registering again reopens them), a backup script and a restore drill that compares every table and database rule. Runbook: [docs/operations.md](docs/operations.md). |
| Fixes from the review | VTA can verify or reject each candidate document with a reason (AD-05/EE-03: before, every document stayed "pending"). Programme lists are paged, searchable and filterable, and beneficiaries are paged (SH-09). New tests for interview outcomes (EM-07), flagging a joining (EM-08) and the cohort report's course and centre filters (AD-11). |

## What works in Phase 9

| Area | What you can do |
| --- | --- |
| Notifications (SH-07) | A bell in every portal header with the unread count (checked every minute while the page is open) and a Notifications page: open one to go to the related page, or mark all as read. Learners hear about application steps, interviews, invitations to apply, enrolment, released results, certificates and profile verification. Trainers: batch assignments and results sent back. Employers: new and withdrawn applications, job decisions, company verification. Partners: verification and new programmes. VTA reviewers: companies, partners and jobs waiting for review, joinings to verify and account closure requests. The person who made a change is not notified about it; internal notes and reasons for rejecting an applicant are never included. |
| Delivery | In-app only. Each notification records recipient, template, channel and delivery state (requirements §12) so SMS, WhatsApp or email can be added once a provider is chosen (D10). Wording lives in `packages/shared/src/notifications.ts`. |
| Password reset | "Forgot password?" on sign-in, for email accounts (staff, employers, partners). Same reply whether or not the email exists; a link works once for 30 minutes and replaces any earlier one; at most 3 emails an hour; using it signs out every session and clears a lockout. |
| Change password | From the account menu: needs the current password; other devices are signed out, this one stays signed in. |
| Download my data | Learners download one JSON file with their account, profile, agreements, training, attendance, released results, certificates, applications (with what was shared) and document list. Logged. |
| Close my account | A learner asks from Privacy (with an optional reason); their profile leaves employer search at once and VTA reviewers are notified. They can cancel. A Super Admin closes the account from the user's page: deactivated, signed out, open applications withdrawn. Records are kept, not erased, until VTA sets a retention rule. |

## What works in Phase 8

| Area | What you can do |
| --- | --- |
| Public home (`/`) | Says what the platform does for learners, employers and training partners, with a way in for each, and a box to check a certificate by its code or link. No figures or claims: those need VTA's evidence. Signed-in people go straight to their portal. The installed app now opens on sign-in instead. |
| Employer sign-up (EM-01) | `/join/employer`: registered name, sector, city, the contact's name, work email and mobile, and acceptance of the notice and terms. Creates the company (pending) and its admin (not active), and emails a link to confirm the email and set a password. The admin then lands on the company profile to add details and a registration document and send it to VTA, the same as a company VTA added. |
| Partner sign-up (PA-01) | `/join/partner`: the same, with partner type instead of sector. A new partner sees no programmes until VTA links it (PA-02). |
| Safeguards | The reply is the same whether or not the email already has an account (no way to find out who is registered). Registering again before confirming sends a fresh link and voids the old one. 5 sign-ups a minute per address; a hidden field catches simple bots. A name matching an existing organisation is flagged "possible duplicate" for VTA, not refused. Nothing is visible to learners or other organisations until VTA verifies it. |
| VTA view | Organisations show "Registered themselves", "Email not confirmed", "Profile not sent yet" and "Possible duplicate". Sign-ups are in the audit log. |
| Notices | The public privacy notice and terms gain a short section for organisations (still DRAFT for VTA's approval). |

## What works in Phase 7

| Area | What you can do |
| --- | --- |
| Partner organisation (PA-01) | The partner admin keeps the organisation profile (type, city, registration number, programme interests, contact) and registration documents, and sends them to VTA; VTA sees them in the organisation dialog. Viewers can read only. |
| Programmes (AD-10) | VTA creates a programme: name, dates, status, target number of people, assigned training partners, optional sponsor, the batches whose enrolments form the cohort, reporting requirements, the beneficiary fields partners may see, and an optional budget reference stored only with its source and date (never presented as finance data). |
| Access (PA-02) | Partners see only programmes assigned to their organisation; anything else is "not found", including documents and downloads. |
| Dashboard (PA-03, §17) | Target, enrolled, active, completed, assessed, passed, certified, job offers, joined (employer-reported) and joined (VTA-verified). Each figure shows its definition and type (actual, target, employer-reported, VTA-verified); every rate shows its denominator. Offers are kept apart from joinings. |
| Beneficiaries (PA-04) | Only the fields VTA approved for the programme. Name, mobile number and date of birth are off by default and can be approved only with a recorded basis (enforced by the API and the database). |
| Documents (PA-05) | Work orders, attendance summaries, reports and evidence: uploaded by VTA or the partner's admins, opened with 5-minute links, every link logged. |
| Reports (PA-06, AD-11) | Programme outcome CSV with no personal data; beneficiary CSV with only the approved columns. VTA's cohort report filters by batch start dates, course, centre, partner and programme. Every download is logged; spreadsheet formulas in exported cells are neutralised. |

## What works in Phase 6

| Area | What you can do |
| --- | --- |
| Company (EM-01, EM-02) | The employer admin completes the company profile (sector, city, contact, optional GSTIN), uploads registration documents and sends it to VTA. VTA sees the profile, documents and any possible duplicate (same GSTIN or name) in the organisation dialog, then verifies, rejects or asks for more. Until verified, jobs can be drafted but not sent for review, and candidate search is closed. The verified name and GSTIN are locked. |
| Team (EM-02) | The employer admin invites recruiters by email and removes them (access ends at once). Recruiters post jobs, search and manage applicants; only admins change the company and team. |
| Jobs (EM-03, AD-09) | Post a job: skill area, skills, experience, city and area, optional monthly salary range, openings, shift, description, closing date, "VTA certificate preferred". VTA reviews each job and publishes, rejects, pauses or closes it with a reason the employer sees. Editing a live job sends it back for review. Employers can pause, resume and close. |
| Learners find and apply (EE-07, EE-08) | Learners see published jobs from verified employers until the closing date, filter by skill, city or words, and apply after seeing exactly what the employer will see. The application keeps a snapshot of what was shared and when; a second active application to the same job is refused (also by the database). |
| Tracking (EE-09) | Status, timeline and interview time and place. Interview notes and how it went stay with the employer. A learner can withdraw; the employer then stops seeing their contact details and documents. |
| Pipeline (EM-05 to EM-08, EM-10) | Applied → shortlisted → interview → offer → joined (with joining date, not in the future) or did not join; "not selected" until then. Each move is timestamped with who made it. Opening an applicant's contact details or a shared document is logged. Interview notes are never written to the audit log. |
| Search (EM-04, EM-05) | Only VTA-verified learners who turned on "employers can find my profile". Filters: skill, city or preferred area, experience, VTA certificate. Results show first name and surname initial, no contact details; opening a profile is logged. Employers can invite a person to apply; the learner sees the invitation on their Jobs page. |
| Outcomes (EM-08) and reports (EM-09, AD-01) | VTA confirms recorded joinings (an offer alone is never a joining) or flags them with a note. Employer dashboard counts applicants, shortlisted, interviews, offers and joinings per job; the admin dashboard adds open jobs, applications, and recorded vs VTA-confirmed joinings. |

## What works in Phase 5

| Area | What you can do |
| --- | --- |
| Self-registration (EE-01) | `/register`: mobile number, name, date of birth (18+), city, and acceptance of the privacy notice and terms; a code proves the number. The profile starts "pending" for VTA to verify and can be finished later. A number that already has an account just signs that person in, so registration cannot be used to find out who is registered. Same name + date of birth is flagged as a possible duplicate. |
| Consent (SH-05) | Every consent is a new row in `consent_events` (append-only, enforced by the database) with the notice version. Candidates added by staff are asked to accept the notice and terms at first sign-in; nothing else opens until they do. Staff see whether it was accepted. |
| Profile (EE-02) | The learner edits skills, experience, education, languages, availability, preferred work area, city and an optional email. Name and date of birth are locked once VTA has verified them; a profile sent back for correction returns to "pending" when fixed. Completeness is shown. |
| Drafts (EE-12) | An unsaved profile edit is kept on the device and restored after a reload; removed on save, cancel or sign-out. |
| Documents (EE-03) | Upload PDF/JPG/PNG evidence (up to 20), choose "only me and VTA" or "employers I share my profile with", change it later, remove own unverified uploads. Verification status is shown; documents added or verified by VTA cannot be removed by the learner. |
| Learning (EE-04) | Each course: batch, centre, dates, status, attendance against the course requirement (with a warning when below), and assessment state (not assessed, in progress, result available). |
| Results (EE-05) | Approved results only: marks, pass mark, each skill's score and trainer comment, and overall trainer feedback. Reviewer identity and internal review notes are never sent. |
| Certificates (EE-06) | Wallet with status (valid, revoked, replaced), QR code, check link and print. Labelled as VTA course completion records, not official qualifications. Revocation reasons are not shown. |
| Privacy (EE-10) | Switch "employers can find my profile" on or off (used by employer search in Phase 6), with the full consent history. |

## What works in Phase 4

| Area | What you can do |
| --- | --- |
| Offline attendance (TR-04) | A trainer opens the app with no signal, picks a batch from "Today" and marks attendance. Marks are saved on the phone, timestamped, and shown as "Waiting to sync". They are sent when the connection returns (automatically, or with "Sync now"). Online, the same screen sends them straight away. |
| Duplicates and conflicts (TR-04) | Every change has an id made on the phone; a change that arrives twice is applied once, even if a later change has overwritten it since. If a different mark was saved after the phone's mark was taken, nothing is overwritten: the trainer sees both and chooses "Use my mark" or "Keep saved mark". A phone clock set in the future cannot win. Changes that can never be saved (batch closed, results submitted, not enrolled, future date) are listed with the reason. Each change is judged on its own. |
| Sync status (TR-08) | Connection, last sync time, what is waiting, conflicts, changes not saved and why, "Sync now", and what is stored on the phone. A status pill in the header says Synced, Offline, N waiting or Sync problem, in words as well as colour. |
| Data on the phone (TR-09) | Only the trainer's running batches: candidate names, candidate IDs and attendance. No phone numbers, addresses, dates of birth or documents. Deleted on sign-out, when someone else signs in on the phone, when the user is not a trainer, and (the roster) after 14 days without a refresh. Signing out with unsynced changes asks first; signing out needs a connection so the server session ends too. |
| Installable app (PWA) | Manifest, icons and a service worker that keeps only the app's own files, never API data. A new version shows "Reload" instead of changing under the user. Trainers get an "Install app" card on Android/Chrome, and the Share → Add to Home Screen steps on iPhone. |

## What works in Phase 3

| Area | What you can do |
| --- | --- |
| Attendance (R-02) | The batch trainer marks each candidate present, absent, late or excused for a date, from the batch's Attendance tab or the "Today" list on their home screen. Only while the batch is active, never for a future date, and a correction is audited with before and after. Retried saves are not applied twice (ready for offline sync in Phase 4). |
| Alerts (R-06) | The roster shows attendance so far and flags anyone below the course's threshold ("at risk"). Excused sessions are not counted. |
| Assessment (R-03) | The trainer enters marks and pass, fail or not assessed for each criterion, saves a draft, and submits. Every required criterion must be assessed. Pass = total at or above the pass mark AND every required criterion passed. After submitting, the result and that candidate's attendance are locked. |
| Review (R-04) | VTA reviewers see a queue of submitted results and approve, return for correction (with a reason) or reject (the trainer reassesses). Nobody can approve a result they submitted; the database enforces this too. Approval releases the result. |
| Completion | Marking a batch completed sets each candidate to completed or not completed from their attendance. |
| Certificates (R-05) | "Issue certificates" on a completed batch issues a course completion record only to candidates who completed AND passed AND were approved, and says why the others were skipped. Each has a printable page with a QR code. Revoke or reissue (for example after a name correction) with a reason. |
| QR check page | `/verify/<code>`: no sign-in, shows only name, course, issue date, issuer and status (valid, revoked or replaced), with fixed wording that it is not a government, NSDC or ASDC qualification. |

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

The demo data also has three courses (2W, 4W and EV), nine candidates (one flagged as a possible duplicate), three running or planned batches at three centres, and a finished batch ("2W Peenya July 2026") with an approved pass, a result waiting for review, a candidate below the attendance threshold and one issued certificate. `pnpm db:seed` prints that certificate's check page link.

**Phone sign-in during development:** there is no SMS provider yet, so the code prints in the API console (`[DEV SMS] OTP code: 123456`). Invitation links appear the same way and in the Invite dialog. Both stubs refuse to run when `NODE_ENV=production`.

## Tests

```bash
pnpm test        # 293 tests: API (real PostgreSQL), shared rules, the phone's offline store
pnpm e2e         # 68 browser tests (Playwright): desktop and phone sizes, offline, accessibility (axe) and security headers
pnpm lint
pnpm typecheck
pnpm build
```

API tests use the database in `TEST_DATABASE_URL` (`vta_test`) and reset it for each file. Browser tests reset `vta_e2e`, start their own API (port 3100) and web app (port 5174), and drive Chromium through real journeys: sign-in by email and phone, course to batch to enrolment, CSV import, document upload and download, what a partner and a trainer can see, attendance to assessment to review to certificate to QR check, phone-size layout, self-registration and the Learner portal, the hiring journey from vacancy to VTA-confirmed joining, partner programmes and reports, and an offline session (the browser is cut off, attendance is taken, the app is reopened offline, then it syncs and a conflict is resolved). Browser tests run the built app with its service worker, as in production.

The demo data uses fixed 2026 dates, so both test suites pin the API's "today" to 26 October 2026 with `VTA_TODAY`. Browser tests also set `VTA_RELAX_RATE_LIMITS=1`, which lifts the per-IP sign-in limits for requests from the same machine only (per-number code limits and lockout still apply). Both settings are ignored in production. First time on a new machine: `pnpm --filter @vta/e2e exec playwright install chromium`.

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
  src/routes      auth, admin/*, training/* (courses, trainers, candidates, batches, files),
                  operations/* (attendance, offline sync, assessments, credentials, public check), health
  src/lib         storage (private files, signed links), csv, crypto
  src/audit       Append-only audit writer
  test            API, isolation and platform tests
apps/web          React + Vite + Tailwind; one app, four portals; installable (vite-plugin-pwa)
  src/offline     The trainer's offline store (IndexedDB) and sync
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
- Password reset emails go nowhere until an email provider is chosen (D10); locally the link is in the API log, and on the staging copy it is shown on screen.
- The privacy notice and terms are a plain-language DRAFT (version `2026-10-draft`), marked as such on screen. VTA must approve the wording and add contact details; changing `NOTICE_VERSION` then asks everyone to accept again.
- Sign-up emails go nowhere until an email provider is chosen (D10); on the staging copy the confirmation link is shown on screen instead. Unconfirmed sign-ups stay listed (flagged) until VTA rejects them; there is no automatic clean-up yet.
- The public front page links to no external VTA website, because its address is not confirmed; add it once VTA confirms.
- Notifications are in-app only; SMS, WhatsApp and email follow the provider decision (D10). They are not deleted yet (no retention rule).
- Closing an account deactivates it and keeps the records; erasure and retention periods need VTA's decision (requirements §13, §15).
- The issuer printed on certificates comes from `CREDENTIAL_ISSUER_NAME` (default "VTA Talent Cloud") until VTA confirms the legal entity (decision D8).
- Offline covers attendance only (as the requirements scope it). Assessments, rosters' contact details and admin screens need a connection.
- The offline store is not encrypted beyond what the phone itself provides; it is kept small instead (names, IDs, attendance). A shared phone should use separate sign-ins: signing in as someone else deletes it.
- Syncing in the background after the app is closed (Background Sync) is Chrome-only, so it is not used; the app syncs when opened or brought to the front.
- The app icons are a placeholder mark. Replace `apps/web/public/icons/*` (regenerate with `e2e/scripts/make-icons.mjs`) once VTA supplies its logo.
- Partner admins cannot create batches; VTA creates them. (README once said this would come with Phase 7; it did not. Decide whether partners need it for the pilot.)
- Lookup lists (skill areas, levels, partner types, sectors) are fixed in code; there are no settings screens (AD-12, Should). Notification wording is in `packages/shared/src/notifications.ts`.
- The learning dashboard has no upcoming sessions (no timetable or LMS link, EE-04); assessments have no evidence-reference field (TR-05); "at risk" means low attendance only (TR-07); the admin dashboard has no date-range filter (AD-01).
- The wordmark is plain text. Swap `Wordmark` in `apps/web/src/components/ui.tsx` for the VTA master logo once supplied.
- Install and offline behaviour is tested in Chromium (desktop and Android size). It still needs a manual check on a real iPhone before the pilot (acceptance criterion).
- A **staging** copy can run on Vercel for review (see [docs/deploy-vercel.md](docs/deploy-vercel.md)): demo data, sign-in codes shown on screen, files kept in the database, uploads up to about 4.5 MB. Pilot hosting is still decision D10.

## Defaults assumed (change any of these at any time)

The D-numbers here are this project's own; requirements §20 numbers its open decisions differently. docs/traceability.md gives both.


- **D1:** a new standalone app, not an extension of an existing VTA LMS.
- **D2:** email and password for staff, employers and partners; phone OTP for learners and trainers.
- **D4:** candidates must be 18 or older during the pilot. Date of birth is required when a candidate is added.
- **D5:** candidates are added by VTA admins, by CSV import, or register themselves (Phase 5); every profile is verified by VTA.
- **Uploads:** PDF, JPG and PNG up to 10 MB.
- **Enrolment:** pending or verified candidates can be enrolled; rejected profiles, profiles needing correction and unreviewed possible duplicates cannot.
- **D8 certificates:** "Course completion record", issued by `CREDENTIAL_ISSUER_NAME`; the check page shows name, course, issue date, issuer and status only.
- **Review:** only Super Admins and Operations Admins review results and issue certificates.
- **Unassessed criteria** count as zero marks; every required criterion must be assessed before submitting.
- **Programmes:** a cohort is the enrolments in the batches linked to the programme. "Active" = attended in the last 14 days. Placement rate = VTA-verified joinings after enrolment ÷ people who completed. Partners see no names unless VTA records a basis.
- **Hiring:** only VTA-verified, opted-in learners appear in search; contact details are shared only through an application. VTA reviews every job before it is published.
- **Consent:** employer search is off until the learner turns it on; staff cannot accept the notice on a learner's behalf.
- **Offline conflicts:** the mark taken last (by capture time) wins automatically; if the saved mark is newer than the phone's, the trainer chooses. Offline roster kept for 14 days without a refresh.
