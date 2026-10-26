# Deploying a staging copy to Vercel

This puts one **staging** copy online for design review and demos. It is not the pilot or production setup. That still needs decision D10 (hosting, SMS/email provider, file storage).

## What the staging copy does differently

| | Local / production | Staging on Vercel (`APP_ENV=staging`) |
|---|---|---|
| SMS and email | Real provider required in production | Console stub. The sign-in code is **shown on screen** |
| Banner | None | Black bar at the top: "Staging copy with demo data. Do not enter real personal information." |
| Demo data | `pnpm db:seed` | Added automatically on the first deploy if the database is empty |
| Uploaded files | Server disk (`STORAGE_DIR`) | Kept in the database (`STORAGE_DRIVER=database`, table `stored_files`) |
| Largest upload | 10 MB | About 4.5 MB (Vercel's request size limit) |

A copy that does not set `APP_ENV=staging` still refuses to start in production with the console stubs.

## How it is built

`vercel.json` runs `node scripts/vercel-build.mjs`, which:

1. checks that `DATABASE_URL`, `APP_ORIGIN` and `FILE_SIGNING_SECRET` are set;
2. runs database migrations (`apps/api/src/db/deploy.ts`), using `DATABASE_URL_UNPOOLED` when present, and seeds demo data once on staging;
3. builds the web app;
4. bundles the API into one Vercel Function (`/api/*`) and writes `.vercel/output` (Build Output API v3). All other paths serve the web app.

## Steps (Vercel dashboard)

1. **Import the project.** Vercel → Add New → Project → import the GitHub repository. Leave Framework Preset as "Other". Build and install commands come from `vercel.json`.
2. **Add a database.** In the project: Storage → Create Database → **Neon** (Postgres). Connect it to the project for all environments. This sets `DATABASE_URL` and `DATABASE_URL_UNPOOLED`. Choose a region close to users (for example Singapore or Mumbai if offered).
3. **Set environment variables** (Settings → Environment Variables):

   | Name | Value |
   |---|---|
   | `APP_ENV` | `staging` |
   | `STORAGE_DRIVER` | `database` |
   | `COOKIE_SECURE` | `true` |
   | `APP_ORIGIN` | the site address, for example `https://vta-talent-cloud.vercel.app` (no trailing slash) |
   | `FILE_SIGNING_SECRET` | a random value of at least 32 characters. Generate one with `openssl rand -hex 32` |
   | `CREDENTIAL_ISSUER_NAME` | optional; defaults to "AutoTalent Grid" |

   Do **not** set `NODE_ENV`. The function sets it itself; setting it in Vercel stops the build tools installing.
4. **Optional: function region.** Settings → Functions → Function Region → pick the one nearest the database (for example Mumbai, `bom1`).
5. **Deploy.** The first deployment usually fails only if a variable is missing; the build log says which one. After adding it, Redeploy.
6. **Get the demo sign-ins.** Open the deployment's build log and find "Demo sign-ins". Staff, employer and partner passwords are printed there once, on the first deploy. Learners and trainers sign in with their phone number; the code appears on screen.
7. **Check it.** Open `https://<your-site>/api/v1/health/ready`: it should say ready. Then sign in from the home page.

If `APP_ORIGIN` does not match the address in the browser, sign-in is refused (the cookie and CSRF checks need it to match). Preview deployments have other addresses, so either use the production address for review or set `APP_ORIGIN` for the Preview environment to that preview's address.

## Resetting the demo data

Delete and recreate the Neon database (or its branch) and redeploy. The seed only runs when there are no users.
