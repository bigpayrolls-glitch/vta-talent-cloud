# Running VTA Talent Cloud

What to do every day, every month and when something goes wrong. Commands run from the repository root with the database address set in `DATABASE_URL` (for Neon, use the direct address in `DATABASE_URL_UNPOOLED`).

## Every day: maintenance job

```bash
pnpm --filter @vta/api maintenance
```

It is safe to run more than once. It:

- deletes sign-in codes older than a day, sessions that ended over 30 days ago and password-reset links older than 7 days;
- closes organisation sign-ups whose email was never confirmed within 30 days. The organisation is marked "rejected" with the reason "Email not confirmed within 30 days" and the unused account is deactivated. Registering again with the same email reopens it.

Each run writes one `maintenance.run` audit event with the counts. Schedule it with the host's scheduler (a cron job on a server, or the hosting platform's scheduled jobs). Until hosting is decided (D10), run it by hand.

## Backups

1. **Automatic backups by the database host.** Turn them on and check how long they are kept and how to restore to a point in time. This is the main protection.
2. **Our own backup**, for a copy you hold yourselves and for the drill:

   ```bash
   pnpm --filter @vta/api backup
   ```

   This writes `backups/vta-<time>.dump`. The `backups/` folder is ignored by Git: store the files somewhere safe and private, because they contain personal data.

Uploaded files: with `STORAGE_DRIVER=database` (the Vercel staging copy) they are inside the database backup. With local disk storage, back up `STORAGE_DIR` too.

`pg_dump` must be at least as new as the database server (for example 16 for PostgreSQL 16).

## Every month: restore drill

A backup counts only if it restores. Restore the newest backup into a scratch database and compare:

```bash
RESTORE_DATABASE_URL=postgres://…/vta_restore_check pnpm --filter @vta/api backup -- --drill
```

The scratch database is wiped first; never point it at the live one (the script refuses if it is the same). It reports every table's row count and checks that the database rules (the append-only audit and consent records) came back. Write the result and the date in the pilot log.

Tested on 26 Oct 2026 with 50,000 learners: 2.15 million rows in 36 tables and 4 database rules restored, with no differences (backup 96 MB).

**Recovery targets (RPO/RTO) are still to be agreed with VTA before production** (requirements §15). With daily backups only, up to a day of changes could be lost; the host's point-in-time restore narrows that.

## Watching the service

- `GET /api/v1/health/live`: the API is running.
- `GET /api/v1/health/ready`: it can reach the database. Point an uptime monitor at this.
- Every API response carries an `x-request-id` header, and error replies include it as `requestId`; the same id is in the logs, so a failing request can be traced. (The web app does not show it to users yet.)
- Logs are JSON lines. Cookies, CSRF tokens and authorisation headers are removed before logging. The development text-message stub masks phone numbers; sign-in codes appear in logs only with that stub.
- No error-monitoring service is connected yet. Choose one with the hosting decision and send it the API's error logs.

## Performance

Requirement: 95% of common read requests under 2.5 seconds at the agreed pilot load. The pilot load is not agreed yet. To measure:

```bash
PERF_DATABASE_URL=postgres://…/vta_perf pnpm --filter @vta/api perf      # 10,000 learners
PERF_LEARNERS=50000 PERF_DATABASE_URL=… pnpm --filter @vta/api perf     # more
```

It wipes that database, adds pilot-scale data and times 17 common read APIs inside the server (database plus application time; network and hosting add to it).

Results on 26 Oct 2026 (one laptop-class machine, local PostgreSQL 16):

| | 10,000 learners | 50,000 learners |
| --- | --- | --- |
| Slowest p95 | 69 ms (audit log, cohort report) | 402 ms (cohort report) |
| Admin dashboard p95 | 33 ms | 138 ms |
| Candidate search p95 | 46 ms | 209 ms |
| Learner job list p95 | 9 ms | 8 ms |

Everything is well under the 2.5-second target. The cohort report, audit log and name search grow with the data; if the pilot grows well beyond 50,000 people, add a trigram index for name search and page the audit log without an exact total.

## When something goes wrong

| Problem | What to do |
| --- | --- |
| Site down | Check `/api/v1/health/ready`. If the database is unreachable, check the database host's status page and the connection settings. |
| Someone locked out | After 5 wrong passwords an account is locked for 15 minutes. A password reset clears the lock. |
| Lost access to an account (staff, employer, partner) | They use "Forgot password?". If the email is wrong, a Super Admin corrects it or invites them again. |
| A learner lost their phone number | **Gap:** there is no screen to change a learner's number yet (the number is how they sign in). Until one is built, a developer changes `users.phone` after VTA has checked who they are, and records why. |
| A secret may have leaked | Change `FILE_SIGNING_SECRET` (all download links stop working at once) and redeploy. To sign everyone out, delete all rows in `sessions`. |
| Data restored from a backup | Run the drill steps above against the restored copy before switching to it. |
| A learner asks for their data or to close their account | They can do both themselves under Privacy. A Super Admin completes closures from the user's page. |
