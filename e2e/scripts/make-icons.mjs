// Draws the app icons (PWA install, home screen, favicon) from the AutoTalent Grid "Road A" symbol.
// Run from e2e/: node scripts/make-icons.mjs   (reads apps/web/public/brand-mark.svg)
import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const web = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../apps/web/public');
const out = path.join(web, 'icons');
mkdirSync(out, { recursive: true });
const mark = readFileSync(path.join(web, 'brand-mark.svg'), 'utf8');

/** White tile with the symbol. `scale` is the symbol's width as a share of the tile; maskable icons keep it inside the safe circle. */
const page = (size, { rounded, scale }) => `<!doctype html><html><body style="margin:0">
<div style="width:${size}px;height:${size}px;background:#fff;border-radius:${rounded ? size * 0.22 : 0}px;display:grid;place-items:center">
<div style="width:${Math.round(size * scale)}px">${mark.replace('<svg ', '<svg style="display:block;width:100%;height:auto" ')}</div>
</div></body></html>`;

const icons = [
  { file: 'icon-192.png', size: 192, rounded: true, scale: 0.74 },
  { file: 'icon-512.png', size: 512, rounded: true, scale: 0.74 },
  { file: 'icon-maskable-512.png', size: 512, scale: 0.6 },
  { file: 'apple-touch-icon.png', size: 180, scale: 0.72 },
  { file: 'favicon-32.png', size: 32, rounded: true, scale: 0.86 },
];

const browser = await chromium.launch();
for (const i of icons) {
  const p = await browser.newPage({ viewport: { width: i.size, height: i.size } });
  await p.setContent(page(i.size, i));
  await p.locator('body > div').screenshot({ path: path.join(out, i.file), omitBackground: true });
  await p.close();
  console.log('wrote', i.file);
}
await browser.close();

// SVG favicon: the symbol on a white rounded tile, sharp at any size.
const inner = mark.replace(/^<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
const [, , w, h] = /viewBox="([\d.\s]+)"/.exec(mark)[1].split(/\s+/).map(Number);
const pad = w * 0.08;
const side = w + pad * 2;
writeFileSync(
  path.join(web, 'favicon.svg'),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${side} ${side}"><rect width="${side}" height="${side}" rx="${side * 0.2}" fill="#fff"/><g transform="translate(${pad} ${(side - h) / 2})">${inner}</g></svg>\n`,
);
console.log('wrote favicon.svg');
