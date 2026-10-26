// Draws the app icons (PWA install, home screen) from the VTA mark. Run from e2e/: node scripts/make-icons.mjs
// Placeholder mark until VTA supplies its logo; replace public/icons/* with the real artwork then.
import { chromium } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';

const out = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../apps/web/public/icons');
mkdirSync(out, { recursive: true });

/** `safe` shrinks the mark so it survives the circle/squircle crop of maskable icons. */
const page = (size, { rounded, safe }) => `<!doctype html><html><body style="margin:0">
<div style="width:${size}px;height:${size}px;background:#B5121B;border-radius:${rounded ? size * 0.1875 : 0}px;display:grid;place-items:center">
<span style="font:800 ${Math.round(size * (safe ? 0.26 : 0.36))}px/1 'DejaVu Sans',Arial,sans-serif;color:#fff;letter-spacing:${-size * 0.004}px">VTA</span>
</div></body></html>`;

const icons = [
  { file: 'icon-192.png', size: 192, rounded: true },
  { file: 'icon-512.png', size: 512, rounded: true },
  { file: 'icon-maskable-512.png', size: 512, safe: true },
  { file: 'apple-touch-icon.png', size: 180 },
];

const browser = await chromium.launch();
for (const i of icons) {
  const p = await browser.newPage({ viewport: { width: i.size, height: i.size } });
  await p.setContent(page(i.size, i));
  await p.locator('div').screenshot({ path: path.join(out, i.file), omitBackground: true });
  await p.close();
  console.log('wrote', i.file);
}
await browser.close();
