# Security

## Reporting a problem

Report suspected vulnerabilities privately to the project owner, not in a public issue. A security contact for VTA is still to be named before the pilot.

## How the platform protects data (review of 26 Oct 2026, Phase 10)

**Access**
- Every API route must declare a permission or be marked public; the server refuses to start otherwise. The public routes are a fixed, tested list (`apps/api/test/platform.test.ts`).
- The server checks role, organisation, centre and programme on every request (SH-02). Records outside a person's scope answer "not found", so their existence is not revealed.
- Employers see a learner's contact details only through an application the learner made, with a snapshot of what was shared.

**Sign-in**
- Passwords are hashed with Argon2id. Common passwords are refused; the minimum length is 10.
- 5 wrong passwords lock an account for 15 minutes.
- Phone codes: 6 digits, valid 5 minutes, 5 attempts, a 60-second gap between sends and 5 per hour per number. Replies never reveal whether a number or email has an account.
- Password-reset links work once, for 30 minutes; at most 3 emails an hour per account. Using one signs out every session.
- Per-address rate limits on sign-in, sign-up, password reset, invitation and certificate-check routes (the health checks have none).

**Sessions**
- The session cookie is HttpOnly, Secure (required in production) and SameSite=Lax. Sessions are stored server-side: only a hash of the token is kept.
- Every state-changing request must carry the session's CSRF token in a header.
- Staff sessions end after 12 hours idle (7 days at most); learner, trainer and partner sessions after 30 days. Suspending or deactivating an account ends its sessions at once.

**Files**
- Uploads are checked by their content (PDF, JPEG, PNG only), limited to 10 MB, and stored privately. Downloads use signed links that work for 5 minutes, and every link handed out is logged.
- Files are not virus-scanned yet (decision D10).

**Headers**
- API: a Content Security Policy of `default-src 'none'`, no framing, HSTS when cookies are secure, and `Cache-Control: no-store` on every response.
- Web app: a Content Security Policy allowing only its own scripts (no inline scripts, no eval), no framing, `nosniff`, a strict referrer policy and a permissions policy turning off camera, microphone, location and payment. Defined once in `apps/web/security-headers.json`; the browser tests run under it and check that no page breaks it.

**Records**
- An audit event is written in the same transaction as every sensitive change. The audit and consent tables are append-only, enforced by database triggers.
- Logs leave out cookies, CSRF tokens and authorisation headers.
- Spreadsheet exports neutralise formulas in cells.

**Build checks** (every pull request)
- Lint, typecheck and the API and browser tests.
- `pnpm audit --prod --audit-level high`: fails on known high or critical vulnerabilities in production dependencies.
- A secret scan (gitleaks) of every commit.
- Dependabot opens weekly update pull requests for dependencies and GitHub Actions.

## Still to do before production

- Penetration test by an independent tester.
- Error monitoring and alerting (with the hosting decision).
- Virus scanning of uploads.
- Named security contact and an incident process with VTA.
- Retention periods for logs, notifications and closed accounts.
