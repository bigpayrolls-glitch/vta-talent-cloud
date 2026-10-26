import { SKILL_AREA_LABEL, type SkillArea } from '@vta/shared';

const inr = (n: number) => `₹${n.toLocaleString('en-IN')}`;

/** Monthly salary range as written on job posts. */
export function salaryText(min: number | null, max: number | null): string {
  if (min == null && max == null) return 'Salary not stated';
  if (min != null && max != null) return min === max ? `${inr(min)} a month` : `${inr(min)} to ${inr(max)} a month`;
  return min != null ? `From ${inr(min)} a month` : `Up to ${inr(max!)} a month`;
}

export function experienceText(months: number): string {
  if (!months) return 'No experience needed';
  if (months < 12) return `${months} months or more`;
  const y = Math.floor(months / 12);
  const m = months % 12;
  return `${y} yr${y > 1 ? 's' : ''}${m ? ` ${m} mo` : ''} or more`;
}

export function experienceHave(months: number): string {
  if (!months) return 'No experience yet';
  const y = Math.floor(months / 12);
  const m = months % 12;
  return y ? `${y} yr${y > 1 ? 's' : ''}${m ? ` ${m} mo` : ''} experience` : `${m} months experience`;
}

export const skillLabel = (s: string) => SKILL_AREA_LABEL[s as SkillArea] ?? s;

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
