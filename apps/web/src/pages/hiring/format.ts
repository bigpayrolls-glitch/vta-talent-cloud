import { SKILL_AREA_LABEL, type SkillArea } from '@vta/shared';
import { t } from '../../lib/i18n';

const inr = (n: number) => `₹${n.toLocaleString('en-IN')}`;

/** Monthly salary range as written on job posts. */
export function salaryText(min: number | null, max: number | null): string {
  if (min == null && max == null) return t('Salary not stated');
  if (min != null && max != null)
    return min === max ? t('{amount} a month', { amount: inr(min) }) : t('{min} to {max} a month', { min: inr(min), max: inr(max) });
  return min != null ? t('From {amount} a month', { amount: inr(min) }) : t('Up to {amount} a month', { amount: inr(max!) });
}

export function experienceText(months: number): string {
  if (!months) return t('No experience needed');
  if (months < 12) return t('{n} months or more', { n: months });
  const y = Math.floor(months / 12);
  const m = months % 12;
  if (m) return y > 1 ? t('{y} yrs {m} mo or more', { y, m }) : t('{y} yr {m} mo or more', { y, m });
  return y > 1 ? t('{y} yrs or more', { y }) : t('{y} yr or more', { y });
}

/** "Needs … experience" chip text for a job the learner does not yet meet (months > 0). */
export function experienceNeeded(months: number): string {
  if (months < 12) return t('Needs {n} months experience', { n: months });
  const y = Math.floor(months / 12);
  const m = months % 12;
  if (m) return y > 1 ? t('Needs {y} yrs {m} mo experience', { y, m }) : t('Needs {y} yr {m} mo experience', { y, m });
  return y > 1 ? t('Needs {y} yrs experience', { y }) : t('Needs {y} yr experience', { y });
}

export function experienceHave(months: number): string {
  if (!months) return t('No experience yet');
  const y = Math.floor(months / 12);
  const m = months % 12;
  if (!y) return t('{n} months experience', { n: m });
  if (m) return y > 1 ? t('{y} yrs {m} mo experience', { y, m }) : t('{y} yr {m} mo experience', { y, m });
  return y > 1 ? t('{y} yrs experience', { y }) : t('{y} yr experience', { y });
}

export const skillLabel = (s: string) => {
  const label = SKILL_AREA_LABEL[s as SkillArea];
  return label ? t(label) : s;
};

export const shortDate = (d: string) => new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(d.length === 10 ? `${d}T00:00:00` : d));
export const dateTime = (d: string) => new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(d));

export interface JobView {
  id: string;
  title: string;
  employer?: string;
  skillArea: string;
  skills: string[];
  minExperienceMonths: number;
  city: string;
  location: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
  openings: number;
  shift: string | null;
  description: string;
  closingDate: string;
  vtaCertificatePreferred: boolean;
  status?: string;
  moderationReason?: string | null;
  publishedAt?: string | null;
  pipeline?: Record<string, number>;
}
