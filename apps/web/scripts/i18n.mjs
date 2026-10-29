// Site translations (see src/lib/i18n.ts).
//   node scripts/i18n.mjs          writes src/locales/_keys.json: every English text the site can translate
//   node scripts/i18n.mjs --check  reports missing translations per language; fails on a broken {placeholder}
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const web = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(web, 'src');
const shared = join(web, '..', '..', 'packages', 'shared', 'src');
// Shared messages and labels that learners see (form errors, skill names, document labels…).
const SHARED_FILES = ['schemas.ts', 'learner.ts', 'catalogue.ts', 'hiring.ts', 'partnerCourses.ts'];

const walk = (d) => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : /\.(tsx?)$/.test(f) && !/\.test\./.test(f) ? [join(d, f)] : []));
const unescape = (s) => s.replace(/\\(['"`\\])/g, '$1').replace(/\\n/g, '\n');

const keys = new Set();
const call = /\b(?:t|tn)\(\s*(?:'((?:\\.|[^'\\])*)'|"((?:\\.|[^"\\])*)"|`((?:\\.|[^`\\$])*)`)/g;
for (const f of walk(src)) {
  for (const m of readFileSync(f, 'utf8').matchAll(call)) keys.add(unescape(m[1] ?? m[2] ?? m[3]));
}
for (const name of SHARED_FILES) {
  const text = readFileSync(join(shared, name), 'utf8');
  for (const m of text.matchAll(/'((?:\\.|[^'\\])*)'/g)) {
    const s = unescape(m[1]);
    const identifier = !s.includes(' ') && /[A-Z]/.test(s.slice(1));
    if (/^[A-Z]/.test(s) && /[a-z]/.test(s) && !identifier && !/https?:|\$\{|^(INR|UPI)$/.test(s)) keys.add(s);
  }
}
keys.delete('');
const sorted = [...keys].sort((a, b) => a.localeCompare(b));
const placeholders = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');

if (process.argv.includes('--check')) {
  let broken = 0;
  for (const f of readdirSync(join(src, 'locales')).filter((f) => /^[a-z]{2}\.json$/.test(f))) {
    const d = JSON.parse(readFileSync(join(src, 'locales', f), 'utf8'));
    const missing = sorted.filter((k) => !d[k]);
    const bad = Object.entries(d).filter(([k, v]) => placeholders(k) !== placeholders(v));
    broken += bad.length;
    console.log(`${f}: ${sorted.length - missing.length}/${sorted.length} translated${bad.length ? `, ${bad.length} with wrong placeholders` : ''}`);
    for (const [k] of bad) console.log(`  placeholder mismatch: ${k}`);
  }
  process.exit(broken ? 1 : 0);
} else {
  writeFileSync(join(src, 'locales', '_keys.json'), JSON.stringify(sorted, null, 1) + '\n');
  console.log(`${sorted.length} texts`);
}
