import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LANGUAGES, t } from './i18n';

const dir = join(__dirname, '..', 'locales');
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');

describe('site languages', () => {
  it('English is the text itself, with placeholders filled in', () => {
    expect(t('Sign in')).toBe('Sign in');
    expect(t('Resend in {s}s', { s: 30 })).toBe('Resend in 30s');
  });

  it('every language in the menu has a file, and every translation keeps its placeholders', () => {
    const keys = JSON.parse(readFileSync(join(dir, '_keys.json'), 'utf8')) as string[];
    for (const { code } of LANGUAGES.filter((l) => l.code !== 'en')) {
      expect(readdirSync(dir)).toContain(`${code}.json`);
      const d = JSON.parse(readFileSync(join(dir, `${code}.json`), 'utf8')) as Record<string, string>;
      for (const [k, v] of Object.entries(d)) {
        expect(typeof v, `${code}: ${k}`).toBe('string');
        expect(placeholders(v), `${code}: ${k}`).toBe(placeholders(k));
      }
      // Most of the site is translated (new English texts may wait for the next translation round).
      const done = keys.filter((k) => d[k]).length;
      expect(done / keys.length, code).toBeGreaterThan(0.9);
    }
  });
});
