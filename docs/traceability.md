# Requirements traceability

This file maps the AutoTalent Grid requirements document (Version 1.0, proposed MVP) to what is built. It was checked against the code and tests, not only README. State: Phases 1 to 10 (26 Oct 2026). Drafted by a reviewer that had not written the code, then updated after the Phase 9 and 10 changes and the fixes its review led to.

Paths are relative to the repository root. `api/` means `apps/api/src/`, `web/` means `apps/web/src/pages/`. Tests are cited as *file › test name*.

## Status key

| Status | Meaning |
| --- | --- |
| Built | Implemented, and a test that exercises it was found and opened. |
| Built, untested | Implemented, but no test found. |
| Partial | Some of the acceptance criteria are met. The Notes column says what is missing. |
| Not built | Not implemented. The reason is given where README states one. |
| External dependency | Waits for a vendor or VTA decision before it can be finished. |

## Summary

Functional requirements (61 IDs: SH 10, AD 12, EM 10, EE 12, TR 9, PA 8):

| Status | Count | IDs |
| --- | --- | --- |
| Built | 52 | SH-02 to 10; AD-02 to 11; EM-01 to 10; EE-01 to 03, 05 to 10; TR-01 to 04, 06, 08, 09; PA-01 to 07 |
| Built, untested | 0 | none |
| Partial | 6 | AD-01, EE-04, EE-11, EE-12, TR-05, TR-07 |
| Not built | 2 | AD-12, PA-08 |
| External dependency | 1 | SH-01 |

Non-functional requirements (§15, 10 areas): Built 3, Partial 6, External dependency 1.

Acceptance criteria (§18, 11 items): Built 9, Partial 2. Appendix A scenario (9 steps): Built 9.

Changed after the review: SH-07 (Phase 9), SH-09 (programme and beneficiary paging), EE-03 and AD-05 (document verification), and new tests for EM-07, EM-08 and AD-11's course and centre filters.

### Items that need a VTA decision

Numbers in brackets are the requirements document's §20 list. README uses its own D-numbers (D1, D2, D4, D5, D8, D10), which do not match §20; both are given where known.

1. **SMS/OTP vendor and account recovery** (§20.4; README D10). Phone sign-in only prints codes to the console. Production start is refused until a provider is set. Staff can change a learner's or trainer's sign-in number after checking who they are (Phase 11).
2. **Email provider** (README D10). Needed for invitations, organisation sign-up confirmation and password reset (all built; the emails go nowhere yet).
3. **Hosting, file storage, virus scanning, monitoring and backups** (§20.8; README D10). Files sit on the API server's disk (or in the database on the staging copy) and are labelled "not scanned". A backup script and a tested restore drill exist (docs/operations.md); the host's own backups still need choosing.
4. **Pilot service target, RPO and RTO** (§15 Availability and Backups).
5. **Legal entity and certificate issuer name** (§20.2; README D8). The issuer comes from `CREDENTIAL_ISSUER_NAME` for now.
6. **Credential types, approval authority, QR fields, accreditation** (§20.5). Assumed: one "course completion record" type; Admins approve.
7. **Privacy notice wording, consent text, employer visibility rules, retention and deletion policy** (§20.6). The notice is a DRAFT (`2026-10-draft`). Learners can download their data and ask to close their account (Phase 9); retention periods are still needed.
8. **Minimum age** (§15 Privacy; README D4). 18+ is assumed for the pilot.
9. **Roles in the MVP** (§20.3). Decided 27 Oct 2026: five logins only (Admin, Employer, Learner, Trainer, Training Partner). Centre Admin, Operations Admin, Recruiter and Partner Viewer were folded in or removed (migration `0014_five_logins`).
10. **Standalone app or LMS extension** (§20.1; README D1). Standalone is assumed. EE-04 has no LMS data.
11. **Languages** (§20.7). English only.
12. **Programme metric definitions** (§13, §17). Assumed: "active" means attended in the last 14 days; placement rate = verified joinings ÷ people who completed. Partners need to agree these.
13. **Brand assets and website address** (§16). The logo, icons and wordmark are placeholders, and the public page has no link to the VTA website.
14. **Pilot centre, batch, employer and partner; budget and launch date** (§20.9, §20.10).

## Shared platform (§6)

| ID | Name | Priority | Status | Where | Evidence | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| SH-01 | Authentication | Must | External dependency | `api/routes/auth.ts`, `web/LoginPage.tsx` | `auth.test.ts` › "locks the account for 15 minutes after 5 failures…", "rejects a code after 5 minutes", "caps codes at 5 an hour per number"; `e2e/tests/auth.spec.ts` › "a learner signs in with a phone code" | Sign-in logic, expiry and rate limits are built and tested. No SMS vendor yet, so codes go to the console. Password reset and change are built (`phase9.test.ts` › "the link sets a new password once…"); the emails need a provider. |
| SH-02 | Role-based access control | Must | Built | `packages/shared/src/permissions.ts`, `api/policy/index.ts` | `platform.test.ts` › "the app refuses to start if a route forgets its permission"; `isolation.test.ts` › "returns 404 (not 403) for out-of-scope records…"; `isolation2.test.ts` › "a centre admin manages batches at their centre only" | Every route names a permission. Records out of scope return "not found". |
| SH-03 | User lifecycle | Must | Built | `api/routes/admin/users.ts`, `web/admin/Users.tsx` | `lifecycle.test.ts` › "suspend → 401 at once; reactivate → can sign in again", "approves a pending user", "only a Super Admin can deactivate"; `auth.test.ts` › "invites by email, accepts with a password…" | Actions are audited. |
| SH-04 | Candidate master record | Must | Built | `api/routes/training/candidates.ts` | `training.test.ts` › "creates an invited candidate with a unique candidate code…", "edits are saved with before and after values…", "flags the same name and date of birth as a possible duplicate…" | IDs look like VTA2600042. |
| SH-05 | Consent and privacy | Must | Built | `api/routes/learner/routes.ts`, `web/learner/PrivacySettings.tsx` | `learner.test.ts` › "a candidate added by staff must accept the current notice and terms on first sign-in", "consent records cannot be changed or deleted, even directly in the database" | Consent is append-only, with the notice version. Each job application keeps a snapshot of what was shared. |
| SH-06 | File/document upload | Must | Built | `api/routes/training/files.ts`, `api/lib/storage.ts` | `files.test.ts` › "checks the real file type…", "refuses files over 10 MB and empty files", "there is no direct URL…" | PDF/JPG/PNG up to 10 MB; 5-minute signed links. No virus scan yet (D10). |
| SH-07 | Notifications | Should | Built | `api/lib/notify.ts`, `api/routes/notifications.ts`, `web/components/Notifications.tsx` | `phase9.test.ts` › "an application reaches the employer; each move reaches the learner…", "unread count, mark one read, mark all read; only your own"; `e2e/tests/phase9.spec.ts` › "a VTA decision shows on the bell…" | In-app only. Each record has recipient, template, channel and delivery state, so SMS, WhatsApp or email can be added with a provider (D10). |
| SH-08 | Audit log | Must | Built | `api/audit/service.ts`, `api/routes/admin/audit.ts`, `web/admin/Audit.tsx` | `platform.test.ts` › "sensitive actions write actor, action, target, request ID and before/after", "rows cannot be updated or deleted, even by the table owner" | The database blocks edits and deletes. |
| SH-09 | Search and filters | Must | Built | `packages/shared/src/schemas.ts` (`listQuerySchema`), list routes | `lifecycle.test.ts` › "lists users with server-side search, filters and pagination"; `training.test.ts` › "searches and filters candidates on the server (T-05)", "lists batches with server-side filters"; `phase10.test.ts` › "pages, searches by name and filters by status…", "beneficiaries come back a page at a time…" | Candidate, batch, course, trainer, user, learner-job, admin-job and programme lists are paged (max 100); programmes can be searched by name and filtered by status; beneficiaries are paged. The employer's own job list shows up to 200 without paging (enough for the pilot). |
| SH-10 | Export | Should | Built | `api/routes/programmes/programmes.ts`, `api/routes/programmes/partner.ts` | `programmes.test.ts` › "the beneficiary download has only the approved columns and is logged…", "exported cells cannot carry spreadsheet formulas" | The only CSV exports are the programme, beneficiary and cohort reports. There is no general candidate-list export. |

## Admin portal (§7)

| ID | Name | Priority | Status | Where | Evidence | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| AD-01 | Operational dashboard | Must | Partial | `api/routes/admin/dashboard.ts`, `web/admin/Dashboard.tsx` | `platform.test.ts` › "dashboard counts what Phase 1 holds, with an as-of time"; `training.test.ts` › "counts courses, batches, enrolments…"; `hiring.test.ts` › "offer, then joined…" (checks `hiring.joinedVerified`) | Shows candidates, batches, employers, partners, open jobs and joinings, with an "as of" time. **Missing:** no assessment-completion count and no date-range filter. |
| AD-02 | Manage courses and levels | Must | Built | `api/routes/training/courses.ts`, `web/training/Courses.tsx` | `training.test.ts` › "creates a course with criteria, a pass rule and an attendance threshold", "an inactive course cannot get new batches" | "Category" is the skill area (a fixed list). |
| AD-03 | Manage centres and trainers | Must | Built | `api/routes/admin/centres.ts`, `api/routes/training/trainers.ts` | `lifecycle.test.ts` › "creates, edits, deactivates and searches centres"; `training.test.ts` › "assigns a trainer to a second centre and verifies them"; `isolation2.test.ts` › "each role lists exactly the batches it should" | |
| AD-04 | Create training batch | Must | Built | `api/routes/training/batches.ts`, `web/training/Batches.tsx` | `training.test.ts` › "creates a batch with course, centre, verified trainer…", "enforces capacity"; `e2e/tests/training.spec.ts` › "an admin creates a batch and enrols candidates" | |
| AD-05 | Candidate approval | Must | Built | `api/routes/training/candidates.ts`, `web/training/Candidates.tsx` | `training.test.ts` › "records approval decisions with reasons and keeps history in the audit log"; `e2e/tests/candidates.spec.ts` › "verify a candidate, upload a certificate…" | Candidate status is pending, verified, rejected or needs correction. Each document can be verified or rejected with a reason (`phase10.test.ts` › "VTA verifies a learner document…", "rejecting needs a reason…"). |
| AD-06 | Assessment review | Must | Built | `api/routes/operations/assessments.ts`, `web/operations/ReviewQueue.tsx` | `operations.test.ts` › "trainers cannot review; a reviewer returns a result for correction with a reason", "nobody can approve a result they submitted (API and database)" | |
| AD-07 | Certificate management | Must | Built | `api/routes/operations/credentials.ts`, `web/VerifyPage.tsx` | `operations.test.ts` › "issues credentials only to candidates who completed, passed and were approved", "revoking shows "revoked" on the verify page; reissuing marks the old one as replaced" | "Supersede" is called "reissue". |
| AD-08 | Employer and partner verification | Must | Built | `api/routes/admin/organisations.ts`, `api/routes/hiring/admin.ts`, `web/admin/Organisations.tsx` | `lifecycle.test.ts` › "verifies, rejects and requests information with reasons"; `hiring.test.ts` › "a pending employer completes the profile…" | |
| AD-09 | Job moderation | Must | Built | `api/routes/hiring/admin.ts`, `web/admin/Hiring.tsx` | `hiring.test.ts` › "editing a published job sends it back to VTA; VTA can pause or close with a reason", "only VTA moderates…" | |
| AD-10 | Programme management | Must | Built | `api/routes/programmes/programmes.ts`, `web/programmes/ProgrammeForm.tsx` | `programmes.test.ts` › "VTA creates a programme for a partner; the partner then sees it", "the programme shows its sponsor, batches and a budget reference with source and date" | The programme has no centre field. Its centres come from the batches linked to it. |
| AD-11 | Reports | Must | Built | `api/routes/programmes/partner.ts` (cohort report), `web/programmes/Reports.tsx` | `programmes.test.ts` › "VTA filters the cohort report by programme, partner, course and dates"; `e2e/tests/programmes.spec.ts` › "VTA filters the cohort report and downloads it" | Course and centre filters are tested in `phase10.test.ts` › "the cohort report filters by course and by centre". The cohort report is aggregate only. |
| AD-12 | Platform configuration | Should | Not built | none | none | Skill areas, levels and partner types are fixed lists in `packages/shared`. There are no screens for locations, qualification labels or notification templates. README does not mention this. |

## Employer portal (§8)

| ID | Name | Priority | Status | Where | Evidence | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| EM-01 | Company onboarding | Must | Built | `api/routes/signup.ts`, `api/routes/hiring/company.ts`, `web/public/JoinPage.tsx`, `web/employer/Company.tsx` | `signup.test.ts` › "creates a pending organisation and an inactive admin…", "a self-registered employer cannot publish jobs or search candidates until VTA verifies it"; `hiring.test.ts` › "a pending employer completes the profile, uploads a document and sends it to VTA" | Sign-up emails need an email provider (D10). |
| EM-02 | Company profile | Must | Built | `api/routes/hiring/company.ts`, `web/employer/Company.tsx` | `hiring.test.ts` › "a verified company's registered name and GSTIN are locked" | Team invitations removed on 27 Oct 2026: one login per employer. |
| EM-03 | Post a vacancy | Must | Built | `api/routes/hiring/employerJobs.ts`, `web/employer/Jobs.tsx` | `hiring.test.ts` › "a recruiter posts a job; it goes to VTA…", "validates the job: salary range, closing date, required fields" | |
| EM-04 | Candidate search | Must | Built | `api/routes/hiring/search.ts`, `web/employer/Candidates.tsx` | `hiring.test.ts` › "only verified candidates who opted in appear…", "filters by certificate and experience…" | Filters: skill, city or area, experience, certificate or course, availability. Only some are tested. |
| EM-05 | View candidate profile | Must | Built | `api/routes/hiring/search.ts`, `web/employer/Application.tsx` | `hiring.test.ts` › "only verified candidates who opted in appear, with a masked name and no contact details" | Contact details are shared only through an application. |
| EM-06 | Shortlist and application pipeline | Must | Built | `api/routes/hiring/employerJobs.ts` | `hiring.test.ts` › "moves follow the pipeline with a timestamped timeline…", "a withdrawn application hides…"; `e2e/tests/hiring.spec.ts` › "the recruiter shortlists, interviews, offers and records the joining" | "Rejected" shows as "not selected". |
| EM-07 | Interview notes | Should | Built | `api/routes/hiring/employerJobs.ts` | `hiring.test.ts` › "scheduling an interview moves it to interview; notes stay with the employer" | Recording an outcome is tested in `phase10.test.ts` › "an interview outcome is recorded; private notes stay with the employer". |
| EM-08 | Hiring outcome | Must | Built | `api/routes/hiring/employerJobs.ts`, `api/routes/hiring/admin.ts`, `web/admin/Hiring.tsx` | `hiring.test.ts` › "offer, then joined with a joining date; VTA verifies the outcome"; `e2e/tests/hiring.spec.ts` › "VTA confirms the recorded joining" | Flagging is tested in `phase10.test.ts` › "VTA can flag a recorded joining with a note". |
| EM-09 | Employer reporting | Should | Built | `api/routes/hiring/employerJobs.ts` (`/employer/dashboard`), `web/employer/Dashboard.tsx` | `hiring.test.ts` › "the employer dashboard counts applicants, shortlists, interviews and joinings per job" | |
| EM-10 | Candidate contact | Must | Built | `api/routes/hiring/employerJobs.ts`, `api/routes/hiring/search.ts` | `hiring.test.ts` › "the employer sees applicants; opening one shows contact details and is logged", "opening a profile is logged…" | |
| EM-P12 | Employer plans and payments (added 26 Oct 2026, not in requirements v1) | Added | Built (test payments only) | `api/routes/hiring/subscription.ts`, `api/lib/subscriptions.ts`, `shared/plans.ts`, `web/employer/Subscription.tsx` | `phase12.test.ts`; `e2e/tests/phase12.spec.ts` › "an employer admin upgrades to Growth with a test payment and gets an invoice" | Requirements v1 §2 lists "complex subscription billing" as out of scope; AutoTalent Grid asked for plans on 26 Oct 2026. On a Free plan, contact details (EM-10) and interviews (EM-07) need an upgrade. Real payments need a provider account and keys; tax invoices need the seller's GSTIN. |
| EE-P13 | Course catalogue and online enrolment (added 26 Oct 2026, not in requirements v1) | Added | Built (test payments only) | `api/routes/learner/catalogue.ts`, `shared/catalogue.ts`, `web/public/Courses.tsx`, `web/learner/Learning.tsx` | `phase13.test.ts`; `e2e/tests/phase13.spec.ts` › "a visitor finds a course, creates an account while enrolling, pays and sees it in My Courses" | Public list and course pages (no sign-in; no people's names), fees per course without GST, seat confirmed at once while the batch has room, the centre is notified. Ratings, Google sign-in, EMI, course materials and messages are not built. Course photos are placeholders. |

## Employee / Technician PWA (§9)

| ID | Name | Priority | Status | Where | Evidence | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| EE-01 | Mobile-first onboarding | Must | Built | `api/routes/auth.ts` (`/register`), `web/RegisterPage.tsx` | `learner.test.ts` › "a new number gets a code; registering creates an active learner…"; `e2e/tests/learner.spec.ts` › "a technician creates their own account and fills in the profile…" | Real SMS sending waits for SH-01's vendor. |
| EE-02 | Technician profile | Must | Built | `api/routes/learner/routes.ts`, `web/learner/Profile.tsx` | `learner.test.ts` › "saves part of a profile at a time and reports what is missing", "name and date of birth are locked once VTA has verified them" | |
| EE-03 | Evidence upload | Should | Built | `api/routes/learner/routes.ts`, `api/routes/training/files.ts`, `web/learner/Documents.tsx` | `learner.test.ts` › "the learner uploads their own evidence and chooses who may see it"; `phase10.test.ts` › "VTA verifies a learner document; the learner can then no longer delete it", "rejecting needs a reason, which the learner sees…" | Status shows as "Not checked yet", "Verified by VTA" or "Not accepted" with VTA's note. |
| EE-04 | Learning dashboard | Must | Partial | `api/routes/learner/routes.ts` (`/me/learning`), `web/learner/Learning.tsx` | `learner.test.ts` › "the learning dashboard shows each course with attendance and assessment state" | Shows courses, attendance progress and assessment state. **Missing:** upcoming sessions, because there is no session timetable and no LMS link (D1). |
| EE-05 | Assessment results | Must | Built | `api/routes/learner/routes.ts` (`/me/results/:id`), `web/learner/Learning.tsx` | `learner.test.ts` › "a released result shows marks and trainer feedback, never reviewer details", "a result not yet approved is not shown…" | |
| EE-06 | Credential wallet | Must | Built | `api/routes/learner/routes.ts`, `web/learner/Certificates.tsx` | `learner.test.ts` › "the wallet lists the person's certificates with a check link…", "a revoked certificate shows as revoked, without the internal reason" | Labelled "course completion record", not an official qualification. |
| EE-07 | Job discovery | Must | Built | `api/routes/hiring/learnerJobs.ts`, `web/learner/Jobs.tsx` | `hiring.test.ts` › "learners see only published, open jobs from verified employers, with filters" | |
| EE-08 | Apply to job | Must | Built | `api/routes/hiring/learnerJobs.ts` | `hiring.test.ts` › "applying needs the sharing confirmation; it stores a snapshot and blocks a second active application"; `e2e/tests/hiring.spec.ts` › "a learner finds the job…and applies" | The database also blocks a second active application. |
| EE-09 | Application tracking | Must | Built | `api/routes/hiring/learnerJobs.ts`, `web/learner/Jobs.tsx` | `hiring.test.ts` › "scheduling an interview…notes stay with the employer"; `e2e/tests/hiring.spec.ts` › "the learner sees the progress and interview time, but not the employer's notes" | |
| EE-10 | Profile sharing control | Must | Built | `api/routes/learner/routes.ts`, `web/learner/PrivacySettings.tsx` | `learner.test.ts` › "turning the searchable profile on and off is recorded each time…"; `hiring.test.ts` › "…turning search off removes the person at once" | |
| EE-11 | PWA install and update | Should | Partial | `apps/web/vite.config.ts`, `apps/web/src/components/UpdatePrompt.tsx`, `web/trainer/InstallCard.tsx` | `e2e/tests/offline.spec.ts` › "the app is installable: manifest, icons and service worker" | Tested in Chromium only. **Missing:** no test of the "Reload" update prompt, and the real-iPhone check README asks for is still outstanding. |
| EE-12 | Low-connectivity behaviour | Should | Partial | `apps/web/src/lib/draft.ts`, `web/learner/Profile.tsx` | `e2e/tests/learner.spec.ts` › "…fills in the profile, keeping an unsaved draft" | Profile drafts are kept and cleared on sign-out. **Missing:** the application note (`note`, up to 500 characters) is not kept as a draft. |

## Trainer PWA (§10)

| ID | Name | Priority | Status | Where | Evidence | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| TR-01 | Assigned batch list | Must | Built | `api/routes/training/batches.ts`, `api/policy/index.ts` | `isolation2.test.ts` › "each role lists exactly the batches it should", "a trainer stops seeing a batch when their role at that centre is removed"; `e2e/tests/training.spec.ts` › "the trainer sees only their own batches…" | |
| TR-02 | Batch roster | Must | Built | `api/routes/training/batches.ts` (`/batches/:id/roster`) | `training.test.ts` › "roster search by name or candidate code"; `operations.test.ts` › "the roster shows attendance so far…" | |
| TR-03 | Attendance capture | Must | Built | `api/routes/operations/attendance.ts`, `web/operations/AttendanceRecorder.tsx` | `operations.test.ts` › "the batch trainer records present, absent, late or excused for a date", "only the assigned trainer can record…"; `e2e/tests/operations.spec.ts` › "the trainer takes attendance from the Today list" | |
| TR-04 | Offline attendance queue | Should | Built | `api/routes/operations/offline.ts`, `apps/web/src/offline/` | `offline.test.ts` › "sending the same changes again…is harmless", "conflict: a mark saved after the phone took its own is kept…"; `e2e/tests/offline.spec.ts` › "a trainer takes attendance offline, and it syncs…" | |
| TR-05 | Practical assessment | Must | Partial | `api/routes/operations/assessments.ts`, `web/operations/AssessmentsTab.tsx` | `operations.test.ts` › "checks marks against each criterion", "saves a draft and works out the total" | Score, pass/fail/not assessed and comments for each criterion are built. **Missing:** no evidence reference field (none in `assessment_scores` or `assessment_results`). |
| TR-06 | Submit results | Must | Built | `api/routes/operations/assessments.ts` | `operations.test.ts` › "submits; the result becomes read-only and the candidate's attendance locks", "the trainer corrects and resubmits; a reviewer approves…" | |
| TR-07 | Progress alerts | Should | Partial | `api/routes/training/batches.ts` (roster), `web/training/Batches.tsx` | `operations.test.ts` › "the roster shows attendance so far and flags anyone below the course threshold" | The threshold is set per course. **Missing:** no flag for missed assessments. "At risk" means low attendance only. The roster does show each assessment's status. |
| TR-08 | Sync status | Must | Built | `web/trainer/SyncStatus.tsx`, `web/trainer/SyncIndicator.tsx` | `e2e/tests/offline.spec.ts` › "a trainer takes attendance offline…", "a conflict is shown with both marks, and the trainer chooses" | |
| TR-09 | Data protection | Must | Built | `apps/web/src/offline/store.ts`, `api/routes/operations/offline.ts` | `offline.test.ts` › "never includes phone numbers, email, dates of birth or addresses"; `store.test.ts` › "deletes everything when a different person signs in on the phone"; `e2e/tests/offline.spec.ts` › "signing out needs a connection, then deletes the offline data…" | The store is not encrypted beyond what the phone provides (README). |

## Partner portal (§11)

| ID | Name | Priority | Status | Where | Evidence | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| PA-01 | Partner onboarding | Must | Built | `api/routes/signup.ts`, `api/routes/programmes/partner.ts`, `web/public/JoinPage.tsx` | `programmes.test.ts` › "the partner admin updates the profile; the viewer can only read; sending needs a document"; `signup.test.ts` › "checks the form: partner type, sector…" | |
| PA-02 | Programme access | Must | Built | `api/routes/programmes/programmes.ts`, `web/programmes/Programmes.tsx` | `programmes.test.ts` › "the assigned partner sees its programme; another partner sees nothing…"; `e2e/tests/programmes.spec.ts` › "…another partner cannot see the programme" | |
| PA-03 | Programme dashboard | Must | Built | `api/routes/programmes/metrics.ts`, `web/programmes/Programmes.tsx` | `programmes.test.ts` › "counts the cohort with a definition for every figure and a denominator for every rate" | |
| PA-04 | Beneficiary list | Must | Built | `api/routes/programmes/programmes.ts` | `programmes.test.ts` › "names, mobile numbers and dates of birth are hidden by default", "VTA can approve names only with a recorded basis…" | A database constraint enforces the basis. The list is not paged (see SH-09). |
| PA-05 | Programme documents | Should | Built | `api/routes/programmes/programmes.ts` | `programmes.test.ts` › "the partner admin uploads; the viewer can open but not upload; another partner cannot" | |
| PA-06 | Outcome reporting | Must | Built | `api/routes/programmes/programmes.ts` (`report.csv`) | `programmes.test.ts` › "the programme report is aggregate only, downloads as CSV and is logged" | |
| PA-07 | Partner users | Should | Removed | none | `fivelogins.test.ts` | Removed on 27 Oct 2026 by decision: one login per training partner. |
| PA-08 | Programme queries | Could | Not built | none | none | Not mentioned in README. |

## Business rules (§13)

| Rule | Status | Evidence | Notes |
| --- | --- | --- | --- |
| Candidate is not the same as an enrolment | Built | `training.test.ts` › "withdraws with a reason, frees the place, and allows re-enrolment" | Enrolments are separate rows. |
| Completion, pass, credential and employment are separate | Built | `operations.test.ts` › "candidates at or above the threshold complete; those below do not", "issues credentials only to candidates who completed, passed and were approved" | |
| Only an authorised reviewer approves results or issues/revokes credentials | Built | `operations.test.ts` › "nobody can approve a result they submitted (API and database)", "trainers cannot review…" | Reviewers are Super Admins and Operations Admins. |
| No ASDC/NSDC labelling | Built | `operations.test.ts` › "the public verify page shows only the approved fields" (checks the disclaimer) | |
| Employer sees contact details only under the consent policy | Built | `hiring.test.ts` › "a withdrawn application hides the person's contact details…" | |
| Partners see only assigned programmes; agreed definitions | Built | `programmes.test.ts` › PA-02 and PA-03 tests | The definitions still need VTA and partner agreement. |
| No "guaranteed job" wording | Built, untested | none | No such wording found in the code. The public page makes no claims. |
| Financial figures labelled | Built | `programmes.test.ts` › "…a budget reference with source and date" | Each figure is marked actual, target, employer-reported or VTA-verified. |
| Deactivate or soft delete rather than delete | Partial | `lifecycle.test.ts` › "only a Super Admin can deactivate"; `learner.test.ts` › "…their own can" (soft delete) | **Missing:** retention rules are not defined (§20.6). |

## Reporting definitions (§17)

| Metric | Status | Evidence | Notes |
| --- | --- | --- | --- |
| Registered candidates | Partial | `training.test.ts` › "counts courses, batches, enrolments…" | Shown as an as-of total only, with no count for a chosen period. |
| Enrolled candidates | Built | `programmes.test.ts` › "counts the cohort…" | Enrolments, with the number of distinct people given separately. |
| Active learners | Built | same | Present or late in the last 14 days (assumed). |
| Completion rate | Built | same | Denominator: enrolments in finished batches. |
| Assessment pass rate | Built | same | Denominator: number assessed. |
| Credentials issued | Built | same | Revoked and replaced records are not counted. |
| Placement / hiring rate | Built | `programmes.test.ts` › "a verified joining after enrolment counts; an offer alone does not…" | Denominator: people who completed. |
| Programme spend / budget | Built | `programmes.test.ts` › "…budget reference with source and date" | Manual budget field only, with no finance link. |

## Non-functional requirements (§15)

Phase 10 (pilot readiness) added the accessibility checks, web security headers, the performance check, the backup and restore drill and the maintenance job. See docs/operations.md and SECURITY.md.

| Area | Status | Evidence | Notes |
| --- | --- | --- | --- |
| Security | Built | `auth.test.ts` › "session cookie is httpOnly and SameSite=Lax", "rate-limits sign-in attempts…", "refuses a state-changing request without the CSRF header"; `e2e/tests/security.spec.ts` (web headers, no Content Security Policy violations, no framing); CI runs `pnpm audit`, gitleaks and Dependabot | HTTPS and a managed secret store come with hosting (D10). An independent penetration test is still recommended (SECURITY.md). |
| Privacy | Partial | `learner.test.ts` SH-05 tests; `training.test.ts` › "blocks under-18s during the pilot (decision D4)"; `phase9.test.ts` › "downloads everything kept about the learner…", "only a Super Admin completes it…" | Self-service data download and closure requests are built. **Missing:** approved notice wording and retention periods (§20.6). |
| Performance | Built | `pnpm --filter @vta/api perf` (docs/operations.md) | Measured 26 Oct 2026: slowest p95 69 ms at 10,000 learners and 402 ms at 50,000, against a 2.5 s target (in-process; hosting adds network time). The pilot load is still to be agreed. |
| Availability | External dependency | none | `/health/live` and `/health/ready` exist. No uptime monitoring. The service target and hosting wait for VTA (D10). |
| Accessibility | Partial | `e2e/tests/a11y.spec.ts` (axe-core WCAG 2.2 A/AA rules on 40 screens in every portal, dialogs, menus, keyboard sign-in) | Automated checks pass. **Missing:** a manual check with a screen reader and keyboard by a person (automated tools find about a third of issues). |
| Responsive UI | Partial | `e2e/tests/mobile.spec.ts` (8 tests at phone size) | Chromium only. **Missing:** no Safari, iOS or Edge runs. |
| PWA | Partial | `e2e/tests/offline.spec.ts` › "the app is installable…" and the offline tests | **Missing:** no test of the update prompt; real-iPhone check outstanding. |
| Backups | Partial | `pnpm --filter @vta/api backup -- --drill` (docs/operations.md) | Backup script and restore drill built and run (2.15 million rows, 36 tables restored with no differences). **Missing:** the host's automatic backups and agreed RPO/RTO (D10). |
| Observability | Partial | `files.test.ts` › "signatures never appear in request logs"; audit tests | Logs are structured, secrets are redacted, every response has a request id, health endpoints exist. **Missing:** central logging, exception monitoring and uptime checks (D10). |
| Data export | Built | `programmes.test.ts` › "the beneficiary download has only the approved columns and is logged…", "the programme report is aggregate only…" | Least privilege: `report.read` is for VTA staff only. |

## Acceptance criteria (§18)

| # | Criterion | Status | Evidence | Notes |
| --- | --- | --- | --- | --- |
| 1 | Each role signs in and reaches its own portal | Built | `auth.test.ts` "Phase 1 test 1" tests; `e2e/tests/auth.spec.ts` › "each role lands in its own portal" | |
| 2 | No access to another organisation's records by URL, ID or payload | Built | `isolation.test.ts` (all); `isolation2.test.ts` › "filters cannot widen the scope" | |
| 3 | Admin creates course, centre, batch, enrols; trainer sees assigned batch only | Built | `e2e/tests/training.spec.ts` (all four); `lifecycle.test.ts` › "creates, edits, deactivates and searches centres" | |
| 4 | Trainer records attendance, submits, sees sync errors; reviewer approves or rejects | Built | `e2e/tests/operations.spec.ts`; `e2e/tests/offline.spec.ts` › "a conflict is shown…"; `operations.test.ts` › "rejecting voids a result…" | |
| 5 | Credential shown only once criteria are met; QR page shows only approved fields | Built | `operations.test.ts` › "refuses batches that are not completed…", "the public verify page shows only the approved fields" | |
| 6 | Employer creates vacancy, searches, shortlists, records outcome | Built | `e2e/tests/hiring.spec.ts` | |
| 7 | Candidate controls visibility, applies, sees status without internal notes | Built | `e2e/tests/learner.spec.ts` › "the learner turns employer search on and off…"; `e2e/tests/hiring.spec.ts` › "the learner sees the progress…" | |
| 8 | Partner sees assigned programme only | Built | `programmes.test.ts` › PA-02 tests; `e2e/tests/programmes.spec.ts` | |
| 9 | Exports are permission-scoped and audited | Built | `programmes.test.ts` › PA-06 / AD-11 tests | |
| 10 | Mobile tested on Android and iOS browsers; PWA install and offline sync tested | Partial | `e2e/tests/mobile.spec.ts`, `e2e/tests/offline.spec.ts` | Chromium at Android size only. A real-iPhone check is still needed (README). |
| 11 | Backup restore, error monitoring, consent logging, account deactivation demonstrated | Partial | `learner.test.ts` › "consent records cannot be changed…"; `lifecycle.test.ts` › "only a Super Admin can deactivate" | Consent logging, deactivation and a restore drill are done. Error monitoring waits for hosting (D10). |

## Appendix A scenario

| Step | Status | Evidence |
| --- | --- | --- |
| 1. Admin approves a trainer and an employer; creates course, centre, batch | Built | `training.test.ts` › "assigns a trainer to a second centre and verifies them"; `e2e/tests/hiring.spec.ts` › "a new employer completes its company profile…VTA…verifies it"; `e2e/tests/training.spec.ts` |
| 2. Admin enrols candidates and assigns the trainer | Built | `training.test.ts` › "enrols candidates…all or nothing", "creates a batch with…verified trainer" (tested with a few candidates, not 20) |
| 3. Trainer records attendance on mobile, including offline, and syncs | Built | `e2e/tests/offline.spec.ts`; `e2e/tests/mobile.spec.ts` › "a trainer's Today list, attendance screen and Sync status fit a phone" |
| 4. Trainer submits results; reviewer approves | Built | `e2e/tests/operations.spec.ts` › "the trainer assesses a candidate…", "a VTA reviewer approves…" |
| 5. Credentials only for eligible candidates | Built | `e2e/tests/operations.spec.ts` › "completing the batch and issuing certificates" |
| 6. Employer publishes vacancy and searches eligible candidates | Built | `e2e/tests/hiring.spec.ts` › "a recruiter posts a job…", "the employer searches candidates (masked)…" |
| 7. Candidate shares and applies; employer shortlists, interviews, records joining | Built | `e2e/tests/hiring.spec.ts` |
| 8. Partner sees aggregate progress and authorised beneficiaries only | Built | `e2e/tests/programmes.spec.ts` › "the partner sees its programme with defined figures, beneficiaries without names…" |
| 9. Admin report shows counts with definitions and denominators; audit records approval and issue | Built | `programmes.test.ts` › "VTA filters the cohort report…"; `operations.test.ts` › "every step is in the audit log" |

## Points the review raised, and what happened

- README had no Phase 9 section on the reviewed branch: added with Phase 9.
- README test counts were out of date: updated (Phase 10).
- Known limits said partner admins would create batches with Phase 7; they still cannot (`batch.manage` excludes `partner_admin`). README now says so plainly.
- No API could verify a document: fixed in Phase 10 (AD-05/EE-03).
- README's decision numbers (D1, D2, D4, D5, D8, D10) differ from requirements §20: README now explains the mapping.
- The root `package.json` description said "Phase 3": fixed.
- Not built and not mentioned before: PA-07 (partner admins inviting their own viewers, built in Phase 11) and AD-12 (settings screens for lookup lists, still not built). README lists them.
