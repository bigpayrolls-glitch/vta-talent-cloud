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
// The web app's own font (Inter), embedded so the name renders the same everywhere.
const inter = readFileSync(path.join(web, '../node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2')).toString('base64');

/**
 * White tile with the symbol and, on icons big enough to read it, "AutoTalent Grid™" beneath (brand artwork of 26 Oct 2026).
 * `scale` is the symbol's width as a share of the tile; maskable icons keep everything inside the safe circle.
 */
const page = (size, { rounded, scale, name }) => `<!doctype html><html><head><style>
@font-face { font-family: Inter; src: url(data:font/woff2;base64,${inter}) format('woff2'); font-weight: 100 900; }
</style></head><body style="margin:0">
<div style="width:${size}px;height:${size}px;background:#fff;border-radius:${rounded ? size * 0.22 : 0}px;display:flex;flex-direction:column;align-items:center;justify-content:center;font-family:Inter">
<div style="width:${Math.round(size * scale)}px">${mark.replace('<svg ', '<svg style="display:block;width:100%;height:auto" ')}</div>
${name ? `<div style="margin-top:${size * 0.035}px;font-weight:850;font-size:${size * name}px;letter-spacing:-0.02em;color:#202124;white-space:nowrap;line-height:1">Auto<span style="color:#D7141C">Talent</span> Grid<sup style="font-size:0.32em;font-weight:600;margin-left:0.06em">™</sup></div>` : ''}
</div></body></html>`;

const icons = [
  { file: 'icon-192.png', size: 192, rounded: true, scale: 0.6, name: 0.105 },
  { file: 'icon-512.png', size: 512, rounded: true, scale: 0.6, name: 0.105 },
  { file: 'icon-maskable-512.png', size: 512, scale: 0.46, name: 0.08 },
  { file: 'apple-touch-icon.png', size: 180, scale: 0.6, name: 0.105 },
  { file: 'favicon-32.png', size: 32, rounded: true, scale: 0.86 },
];

const browser = await chromium.launch();
for (const i of icons) {
  const p = await browser.newPage({ viewport: { width: i.size, height: i.size } });
  await p.setContent(page(i.size, i));
  await p.evaluate(() => document.fonts.ready);
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
