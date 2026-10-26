// Builds VTA Talent Cloud for Vercel using the Build Output API (https://vercel.com/docs/build-output-api/v3):
//   1. applies database migrations (and loads demo data once on staging),
//   2. builds the web app into static files,
//   3. bundles the API into one Vercel Function served at /api/*.
// Run by Vercel ("buildCommand" in vercel.json). Needs DATABASE_URL and the other settings in docs/deploy-vercel.md.
import { execSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, '.vercel/output');
const apiDir = path.join(root, 'apps/api');
const run = (cmd, env = {}) => execSync(cmd, { cwd: root, stdio: 'inherit', env: { ...process.env, ...env } });

const required = ['DATABASE_URL', 'APP_ORIGIN', 'FILE_SIGNING_SECRET'];
const missing = required.filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`\nMissing environment variables: ${missing.join(', ')}. See docs/deploy-vercel.md.\n`);
  process.exit(1);
}

console.log('\n▶ Database: migrations (and demo data on staging)');
run('pnpm --filter @vta/api exec tsx src/db/deploy.ts');

console.log('\n▶ Web app');
run('pnpm --filter @vta/web exec vite build', { VITE_APP_ENV: process.env.APP_ENV ?? 'production' });

console.log('\n▶ API function');
rmSync(out, { recursive: true, force: true });
const fn = path.join(out, 'functions/api.func');
mkdirSync(fn, { recursive: true });
const requireFromApi = createRequire(path.join(apiDir, 'package.json'));
const { build } = requireFromApi('esbuild');
await build({
  entryPoints: [path.join(apiDir, 'src/vercel.ts')],
  outfile: path.join(fn, 'index.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  // Native password hashing stays a real package (copied below); pg-native is optional and not used.
  external: ['@node-rs/argon2', 'pg-native', 'pino-pretty'],
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
  logLevel: 'warning',
});
// Copy the native argon2 package and its Linux binary (pnpm keeps them in its store, so dereference).
const argon2Dir = path.dirname(realpathSync(requireFromApi.resolve('@node-rs/argon2/package.json')));
const requireFromArgon2 = createRequire(path.join(argon2Dir, 'package.json'));
const copyPkg = (name, dir) => cpSync(dir, path.join(fn, 'node_modules', name), { recursive: true, dereference: true });
copyPkg('@node-rs/argon2', argon2Dir);
for (const binary of ['@node-rs/argon2-linux-x64-gnu']) {
  try {
    copyPkg(binary, path.dirname(realpathSync(requireFromArgon2.resolve(`${binary}/package.json`))));
  } catch {
    console.warn(`(${binary} not installed on this machine; it must exist on the Vercel build image)`);
  }
}
writeFileSync(path.join(fn, 'package.json'), JSON.stringify({ type: 'module' }));
writeFileSync(
  path.join(fn, '.vc-config.json'),
  JSON.stringify({ runtime: 'nodejs22.x', handler: 'index.mjs', launcherType: 'Nodejs', shouldAddHelpers: false, maxDuration: 30 }, null, 2),
);

console.log('\n▶ Static files and routes');
const webHeaders = Object.fromEntries(Object.entries(JSON.parse(readFileSync(path.join(root, 'apps/web/security-headers.json'), 'utf8'))).filter(([k]) => k !== '//'));
cpSync(path.join(root, 'apps/web/dist'), path.join(out, 'static'), { recursive: true });
writeFileSync(
  path.join(out, 'config.json'),
  JSON.stringify(
    {
      version: 3,
      routes: [
        // Phase 10: security headers on every page and file (the API sets its own, stricter ones).
        { src: '/(?!api/)(.*)', headers: { ...webHeaders, 'Strict-Transport-Security': 'max-age=31536000; includeSubDomains' }, continue: true },
        // The service worker and manifest must always be fresh, so new versions are found.
        { src: '/(sw\\.js|manifest\\.webmanifest)', headers: { 'cache-control': 'no-cache' }, continue: true },
        { src: '/assets/(.*)', headers: { 'cache-control': 'public, max-age=31536000, immutable' }, continue: true },
        { src: '/api/(.*)', dest: '/api?__path=/api/$1' },
        { handle: 'filesystem' },
        // Single-page app: every other path is the app shell.
        { src: '/(.*)', dest: '/index.html' },
      ],
    },
    null,
    2,
  ),
);
console.log('\nBuild output ready in .vercel/output\n');
