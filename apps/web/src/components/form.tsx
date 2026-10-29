import { SKILL_AREA_LABEL, SKILL_AREAS, type SkillArea } from '@vta/shared';
import { Search } from 'lucide-react';
import { useState } from 'react';
import { t } from '../lib/i18n';

/** Toggle chips for picking skill areas (2W, 4W, EV, CV, other). */
export function SkillAreaPicker({ value, onChange, id }: { value: string[]; onChange: (v: SkillArea[]) => void; id: string }) {
  return (
    <div role="group" aria-labelledby={id} className="flex flex-wrap gap-2">
      {SKILL_AREAS.map((s) => {
        const on = value.includes(s);
        return (
          <button
            key={s}
            type="button"
            aria-pressed={on}
            onClick={() => onChange((on ? value.filter((x) => x !== s) : [...value, s]) as SkillArea[])}
            className={`h-9 rounded-full border px-3.5 text-sm font-medium transition-colors ${on ? 'border-brand bg-brand-tint text-brand' : 'border-line bg-white text-ink hover:bg-surface'}`}
          >
            {s === 'other' ? t('Other') : s}
            <span className="sr-only"> ({t(SKILL_AREA_LABEL[s])})</span>
          </button>
        );
      })}
    </div>
  );
}

export function SkillTags({ areas }: { areas: string[] }) {
  if (!areas.length) return <span className="text-muted">—</span>;
  return (
    <span className="inline-flex flex-wrap gap-1">
      {areas.map((a) => (
        <span key={a} className="rounded-md bg-surface px-1.5 py-0.5 text-xs font-semibold text-ink" title={SKILL_AREA_LABEL[a as SkillArea] && t(SKILL_AREA_LABEL[a as SkillArea])}>
          {a === 'other' ? t('Other') : a}
        </span>
      ))}
    </span>
  );
}

/** Search box that applies on Enter (server-side search, so no request per keystroke). */
export function SearchBox({ initial, onSearch, placeholder, label }: { initial: string; onSearch: (q: string) => void; placeholder: string; label: string }) {
  const [q, setQ] = useState(initial);
  const id = `search-${label.replace(/\W/g, '').toLowerCase()}`;
  return (
    <form
      className="relative flex-1"
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        onSearch(q.trim());
      }}
    >
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <input id={id} type="search" className="field-input pl-9" placeholder={placeholder} value={q} onChange={(e) => setQ(e.target.value)} />
    </form>
  );
}

export function Select({ id, label, value, onChange, options, className = '' }: { id: string; label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; className?: string }) {
  return (
    <>
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <select id={id} className={`field-input ${className}`} value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </>
  );
}

/** "3 months", "6 weeks" */
export function durationText(value: number, unit: string) {
  const one = value === 1;
  if (unit === 'days') return one ? t('{n} day', { n: value }) : t('{n} days', { n: value });
  if (unit === 'weeks') return one ? t('{n} week', { n: value }) : t('{n} weeks', { n: value });
  if (unit === 'months') return one ? t('{n} month', { n: value }) : t('{n} months', { n: value });
  const u = one ? unit.replace(/s$/, '') : unit;
  return `${value} ${u}`;
}

export function dateRange(start: string, end: string) {
  const f = (d: string) => new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(`${d}T00:00:00`));
  return `${f(start)} – ${f(end)}`;
}
