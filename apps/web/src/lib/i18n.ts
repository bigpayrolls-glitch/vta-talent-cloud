import { Fragment, createElement, type ReactNode } from 'react';

/**
 * Site languages (29 Oct 2026). English text is the key: `t('Sign in')` looks the sentence up in the chosen
 * language's file in src/locales and falls back to English when there is no translation yet. Placeholders are
 * `{name}`: `t('Resend in {s}s', { s: 30 })`. `tn` does the same but a placeholder can be a link or other element,
 * so a whole sentence is translated at once and the word order suits each language.
 *
 * Choosing a language re-renders the whole app (main.tsx keys the tree on it), so plain `t()` calls are enough.
 * Admin, employer and partner screens are not translated yet; strings without a translation show in English.
 */

export const LANGUAGES = [
  { code: 'en', name: 'English' },
  { code: 'hi', name: 'हिन्दी' },
  { code: 'kn', name: 'ಕನ್ನಡ' },
  { code: 'ta', name: 'தமிழ்' },
  { code: 'te', name: 'తెలుగు' },
  { code: 'ml', name: 'മലയാളം' },
  { code: 'mr', name: 'मराठी' },
  { code: 'bn', name: 'বাংলা' },
  { code: 'gu', name: 'ગુજરાતી' },
] as const;
export type Lang = (typeof LANGUAGES)[number]['code'];

const STORE_KEY = 'atg.lang';
const files = import.meta.glob<Record<string, string>>('../locales/*.json', { import: 'default' });

let lang: Lang = 'en';
let dict: Record<string, string> = {};
const listeners = new Set<() => void>();

const isLang = (x: unknown): x is Lang => LANGUAGES.some((l) => l.code === x);

function saved(): Lang {
  try {
    const v = localStorage.getItem(STORE_KEY);
    if (isLang(v)) return v;
  } catch {
    /* storage blocked */
  }
  return 'en';
}

async function load(next: Lang): Promise<Record<string, string>> {
  if (next === 'en') return {};
  const f = files[`../locales/${next}.json`];
  return f ? await f() : {};
}

/** Called once before the first render, so a saved language shows without a flash of English. */
export async function initI18n(): Promise<void> {
  const want = saved();
  try {
    dict = await load(want);
    lang = want;
  } catch {
    lang = 'en';
    dict = {};
  }
  document.documentElement.lang = lang;
}

export function currentLang(): Lang {
  return lang;
}

export async function setLang(next: Lang): Promise<void> {
  dict = await load(next);
  lang = next;
  document.documentElement.lang = next;
  try {
    localStorage.setItem(STORE_KEY, next);
  } catch {
    /* storage blocked: the choice lasts until the page is reloaded */
  }
  listeners.forEach((l) => l());
}

export function onLangChange(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

type Vars = Record<string, string | number>;

/** The text in the chosen language. */
export function t(text: string, vars?: Vars): string {
  const s = dict[text] || text;
  return vars ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : s;
}

/** Like `t`, but placeholders may be elements (links, bold text). */
export function tn(text: string, vars: Record<string, ReactNode>): ReactNode {
  const parts = (dict[text] || text).split(/\{(\w+)\}/g);
  return createElement(
    Fragment,
    null,
    ...parts.map((p, i) => createElement(Fragment, { key: i }, i % 2 === 1 ? (p in vars ? vars[p] : `{${p}}`) : p)),
  );
}
