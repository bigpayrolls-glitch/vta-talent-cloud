import { useQuery, useQueryClient } from '@tanstack/react-query';
import { learnerProfileSchema, SKILL_AREA_LABEL, type SkillArea } from '@vta/shared';
import { Lock, Pencil } from 'lucide-react';
import { useState } from 'react';
import { SkillAreaPicker } from '../../components/form';
import { useToast } from '../../components/toast';
import { ErrorNote, Field, formatPhone, PageHeader, Spinner, StatusBadge } from '../../components/ui';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useDraft } from '../../lib/draft';
import { useForm } from '../../lib/useForm';
import { fmtDate } from './attendance';
import type { LearnerProfile } from './types';

const years = (m: number) => (m >= 12 ? `${Math.floor(m / 12)} yr${m >= 24 ? 's' : ''}${m % 12 ? ` ${m % 12} mo` : ''}` : `${m} months`);

/** EE-02: the learner's own profile. Saves part at a time; unfinished edits are kept on the device (EE-12). */
export function ProfilePage() {
  const q = useQuery({ queryKey: ['me', 'profile'], queryFn: () => api.get<LearnerProfile>('/me/profile') });
  const [editing, setEditing] = useState(false);
  if (q.isLoading) return <Spinner />;
  if (q.isError) return <ErrorNote message={(q.error as Error).message} />;
  const p = q.data!;
  return (
    <>
      <PageHeader
        title="My profile"
        description={`Candidate ID ${p.candidateCode}`}
        actions={
          !editing && (
            <button type="button" className="btn-primary" onClick={() => setEditing(true)}>
              <Pencil className="size-4" aria-hidden />
              Edit profile
            </button>
          )
        }
      />
      {p.verificationStatus === 'needs_correction' && p.verificationReason && (
        <p role="status" className="mb-4 rounded-lg bg-warning-tint px-4 py-3 text-sm text-warning">
          <span className="font-semibold">AutoTalent Grid asked for a correction:</span> {p.verificationReason}
        </p>
      )}
      {editing ? <ProfileForm profile={p} onDone={() => setEditing(false)} /> : <ProfileView p={p} />}
    </>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-0.5 px-5 py-3 sm:grid-cols-[200px_1fr]">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="font-medium">{children || <span className="font-normal text-muted">Not added</span>}</dd>
    </div>
  );
}

function ProfileView({ p }: { p: LearnerProfile }) {
  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_280px]">
      <dl className="card divide-y divide-line">
        <Row label="Name">{p.name}</Row>
        <Row label="Date of birth">{p.dateOfBirth ? fmtDate(p.dateOfBirth) : ''}</Row>
        <Row label="Mobile">{formatPhone(p.phone)}</Row>
        <Row label="Email">{p.email}</Row>
        <Row label="City">{[p.city, p.state].filter(Boolean).join(', ')}</Row>
        <Row label="Preferred work area">{p.preferredWorkArea}</Row>
        <Row label="Skills">{p.skillAreas.map((s) => SKILL_AREA_LABEL[s as SkillArea] ?? s).join(', ')}</Row>
        <Row label="Experience">{p.experienceMonths ? years(p.experienceMonths) : ''}</Row>
        <Row label="Education">{p.education}</Row>
        <Row label="Languages">{p.languages.join(', ')}</Row>
        <Row label="Availability">{p.availability}</Row>
      </dl>
      <aside className="card h-fit px-5 py-4">
        <p className="text-sm text-muted">Verification</p>
        <div className="mt-1">
          <StatusBadge status={p.verificationStatus} />
        </div>
        <p className="mt-4 text-sm text-muted">Profile complete</p>
        <p className="text-2xl font-bold">{p.completeness.pct}%</p>
        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface" aria-hidden>
          <div className="h-full rounded-full bg-brand" style={{ width: `${p.completeness.pct}%` }} />
        </div>
        {p.completeness.missing.length > 0 && <p className="mt-2 text-[13px] text-muted">Still to add: {p.completeness.missing.join(', ')}</p>}
      </aside>
    </div>
  );
}

function ProfileForm({ profile: p, onDone }: { profile: LearnerProfile; onDone: () => void }) {
  const { me } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const f = useForm(learnerProfileSchema);
  const initial = {
    name: p.name,
    dateOfBirth: p.dateOfBirth ?? '',
    email: p.email ?? '',
    city: p.city,
    state: p.state ?? '',
    preferredWorkArea: p.preferredWorkArea ?? '',
    skillAreas: p.skillAreas as SkillArea[],
    experienceMonths: String(p.experienceMonths),
    education: p.education ?? '',
    languages: p.languages.join(', '),
    availability: p.availability ?? '',
  };
  const draft = useDraft(`profile:${me?.id ?? 'anon'}`, initial);
  const v = draft.value;
  const set = (k: keyof typeof initial) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => draft.setValue({ ...v, [k]: e.target.value });

  const save = () =>
    f.submit(
      {
        ...(p.identityLocked ? {} : { name: v.name, dateOfBirth: v.dateOfBirth }),
        email: v.email,
        city: v.city,
        state: v.state,
        preferredWorkArea: v.preferredWorkArea,
        skillAreas: v.skillAreas,
        experienceMonths: v.experienceMonths,
        education: v.education,
        languages: v.languages
          .split(',')
          .map((x) => x.trim())
          .filter(Boolean),
        availability: v.availability,
      },
      async (data) => {
        const res = await api.patch<LearnerProfile>('/me/profile', data);
        draft.clear();
        qc.setQueryData(['me', 'profile'], res);
        toast('success', res.verificationStatus === 'pending' && p.verificationStatus === 'needs_correction' ? 'Saved and sent back to AutoTalent Grid for checking' : 'Profile saved');
        onDone();
      },
    );

  return (
    <form
      noValidate
      className="card max-w-2xl space-y-4 px-5 py-5"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      {draft.restored && <p className="rounded-lg bg-info-tint px-3 py-2 text-sm text-info">Your unsaved changes from last time were kept on this phone.</p>}
      {f.formError && <ErrorNote message={f.formError} />}
      {p.identityLocked ? (
        <p className="flex items-start gap-2 rounded-lg bg-surface px-3 py-2 text-sm">
          <Lock className="mt-0.5 size-4 shrink-0" aria-hidden />
          Your name and date of birth were checked by AutoTalent Grid. To correct them, ask your training centre.
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Full name" htmlFor="p-name" error={f.errors.name}>
            <input id="p-name" className="field-input" value={v.name} onChange={set('name')} />
          </Field>
          <Field label="Date of birth" htmlFor="p-dob" error={f.errors.dateOfBirth}>
            <input id="p-dob" type="date" className="field-input" value={v.dateOfBirth} onChange={set('dateOfBirth')} />
          </Field>
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="City or town" htmlFor="p-city" error={f.errors.city}>
          <input id="p-city" className="field-input" value={v.city} onChange={set('city')} />
        </Field>
        <Field label="State" htmlFor="p-state" error={f.errors.state}>
          <input id="p-state" className="field-input" value={v.state} onChange={set('state')} />
        </Field>
      </div>
      <Field label="Preferred work area" htmlFor="p-area" error={f.errors.preferredWorkArea} hint="Where you would like to work, for example Peenya or anywhere in Bengaluru.">
        <input id="p-area" className="field-input" value={v.preferredWorkArea} onChange={set('preferredWorkArea')} />
      </Field>
      <div>
        <span className="field-label" id="p-skills-label">
          Skills
        </span>
        <SkillAreaPicker id="p-skills-label" value={v.skillAreas} onChange={(s) => draft.setValue({ ...v, skillAreas: s })} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Experience (months)" htmlFor="p-exp" error={f.errors.experienceMonths}>
          <input id="p-exp" type="number" min={0} inputMode="numeric" className="field-input" value={v.experienceMonths} onChange={set('experienceMonths')} />
        </Field>
        <Field label="Availability" htmlFor="p-avail" error={f.errors.availability} hint="For example: weekdays, from 1 December.">
          <input id="p-avail" className="field-input" value={v.availability} onChange={set('availability')} />
        </Field>
      </div>
      <Field label="Education" htmlFor="p-edu" error={f.errors.education} hint="For example: ITI Motor Mechanic, 10th pass.">
        <input id="p-edu" className="field-input" value={v.education} onChange={set('education')} />
      </Field>
      <Field label="Languages" htmlFor="p-lang" error={f.errors.languages} hint="Separate with commas.">
        <input id="p-lang" className="field-input" value={v.languages} onChange={set('languages')} />
      </Field>
      <Field label="Email (optional)" htmlFor="p-email" error={f.errors.email}>
        <input id="p-email" type="email" inputMode="email" className="field-input" value={v.email} onChange={set('email')} />
      </Field>
      <div className="flex flex-wrap gap-2 pt-2">
        <button type="submit" className="btn-primary" disabled={f.submitting}>
          {f.submitting ? 'Saving…' : 'Save profile'}
        </button>
        <button
          type="button"
          className="btn-secondary"
          onClick={() => {
            draft.clear();
            onDone();
          }}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
