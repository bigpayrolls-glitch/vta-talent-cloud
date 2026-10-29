import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  COURSE_LEVEL_LABEL,
  COURSE_LEVELS,
  courseSchema,
  criteriaListSchema,
  DELIVERY_MODES,
  DURATION_UNITS,
  SKILL_AREA_LABEL,
  SKILL_AREAS,
  type Page,
  TRACK_LABEL,
  TRACK_STEP_LABEL,
  type Track,
  type TrackStep,
} from '@vta/shared';
import { ArrowLeft, Lock, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { durationText, SearchBox, Select, SkillTags } from '../../components/form';
import { StayFields } from '../../components/StayFields';
import { useToast } from '../../components/toast';
import { EmptyState, ErrorNote, Field, Modal, PageHeader, Pagination, Spinner, StatusBadge } from '../../components/ui';
import { api, qs } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useForm } from '../../lib/useForm';
import { useListParams } from '../../lib/useListParams';

export interface CourseRow {
  id: string;
  code: string | null;
  title: string;
  skillArea: string;
  level: keyof typeof COURSE_LEVEL_LABEL;
  deliveryMode: string;
  durationValue: number;
  durationUnit: string;
  trainingHours: number | null;
  prerequisites: string | null;
  description: string | null;
  attendanceThresholdPct: number;
  passMarkPct: number;
  feeRupees: number;
  stayAvailable: boolean;
  stayFeeRupees: number | null;
  track: Track | null;
  trackStep: number | null;
  status: 'active' | 'inactive';
  approvalStatus?: 'draft' | 'submitted' | 'changes_requested' | 'rejected' | 'published';
  owner?: { id: string; name: string } | null;
  criteriaCount?: number;
  batchCount?: number;
}
interface Criterion {
  label: string;
  maxScore: number;
  required: boolean;
}
interface CourseDetail extends CourseRow {
  criteria: (Criterion & { id: string })[];
  criteriaLocked: boolean;
}

const MODE_LABEL: Record<string, string> = { classroom: 'Classroom', online: 'Online', blended: 'Blended' };

export function CoursesPage() {
  const { can } = useAuth();
  const { values, page, set, setPage } = useListParams(['q', 'skillArea', 'status'] as const);
  const [creating, setCreating] = useState(false);
  const q = useQuery({
    queryKey: ['courses', values, page],
    queryFn: () => api.get<Page<CourseRow>>(`/courses${qs({ ...values, page, pageSize: 20 })}`),
    placeholderData: (p) => p,
  });

  return (
    <div>
      <PageHeader
        title="Courses"
        description="The course catalogue: duration, pass rules and the criteria trainers assess."
        actions={
          can('course.manage') && (
            <button className="btn-primary" onClick={() => setCreating(true)}>
              <Plus className="size-4" aria-hidden />
              Add course
            </button>
          )
        }
      />
      <div className="mb-4 flex flex-col gap-3 md:flex-row">
        <SearchBox initial={values.q} onSearch={(v) => set('q', v)} placeholder="Search by title or code" label="Search courses" />
        <div className="flex gap-3">
          <Select id="c-skill" label="Skill area" className="md:w-48" value={values.skillArea} onChange={(v) => set('skillArea', v)} options={[{ value: '', label: 'All skill areas' }, ...SKILL_AREAS.map((s) => ({ value: s, label: SKILL_AREA_LABEL[s] }))]} />
          <Select id="c-status" label="Status" className="md:w-36" value={values.status} onChange={(v) => set('status', v)} options={[{ value: '', label: 'Any status' }, { value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }]} />
        </div>
      </div>
      <div className="card overflow-hidden">
        {q.isLoading ? (
          <Spinner />
        ) : q.isError ? (
          <div className="p-4"><ErrorNote message={(q.error as Error).message} /></div>
        ) : q.data!.items.length === 0 ? (
          <EmptyState title="No courses found" body={can('course.manage') ? 'Add a course before creating batches.' : undefined} />
        ) : (
          <>
            <ul className="divide-y divide-line">
              {q.data!.items.map((c) => (
                <li key={c.id}>
                  <Link to={`/admin/courses/${c.id}`} className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-5 py-4 hover:bg-surface/60">
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold">{c.title}</span>
                        <SkillTags areas={[c.skillArea]} />
                      </span>
                      <span className="mt-0.5 block text-sm text-muted">
                        {[c.code, durationText(c.durationValue, c.durationUnit), COURSE_LEVEL_LABEL[c.level], MODE_LABEL[c.deliveryMode], c.owner && `by ${c.owner.name}`].filter(Boolean).join(' | ')}
                      </span>
                    </span>
                    <span className="text-sm text-muted">
                      {c.criteriaCount} criteria, {c.batchCount} {c.batchCount === 1 ? 'batch' : 'batches'}
                    </span>
                    {c.approvalStatus && c.approvalStatus !== 'published' ? <StatusBadge status={c.approvalStatus} /> : <StatusBadge status={c.status} />}
                  </Link>
                </li>
              ))}
            </ul>
            <Pagination page={q.data!.page} pageSize={q.data!.pageSize} total={q.data!.total} onPage={setPage} />
          </>
        )}
      </div>
      {creating && <CourseModal onClose={() => setCreating(false)} />}
    </div>
  );
}

export function CourseDetailPage() {
  const { id = '' } = useParams();
  const { can } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [editingCriteria, setEditingCriteria] = useState(false);
  const q = useQuery({ queryKey: ['course', id], queryFn: () => api.get<CourseDetail>(`/courses/${id}`) });
  if (q.isLoading) return <Spinner />;
  if (q.isError) return <ErrorNote message={(q.error as Error).message} />;
  const c = q.data!;
  const manage = can('course.manage');
  const total = c.criteria.reduce((s, x) => s + x.maxScore, 0);

  const toggle = async () => {
    try {
      await api.post(`/admin/courses/${c.id}/${c.status === 'active' ? 'deactivate' : 'activate'}`);
      await qc.invalidateQueries({ queryKey: ['course'] });
      await qc.invalidateQueries({ queryKey: ['courses'] });
      toast('success', c.status === 'active' ? 'Course deactivated. Existing batches continue.' : 'Course reactivated');
    } catch (e) {
      toast('error', (e as Error).message);
    }
  };

  return (
    <div>
      <Link to="/admin/courses" className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-muted hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden />
        All courses
      </Link>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-[26px] font-bold tracking-tight">{c.title}</h1>
            <StatusBadge status={c.status} />
          </div>
          <p className="mt-1 text-muted">{[c.code, SKILL_AREA_LABEL[c.skillArea as keyof typeof SKILL_AREA_LABEL]].filter(Boolean).join(' | ')}</p>
        </div>
        {manage && (
          <div className="flex flex-wrap gap-2">
            <button className="btn-secondary" onClick={() => setEditing(true)}>Edit details</button>
            <button className={`btn-secondary ${c.status === 'active' ? 'text-brand' : ''}`} onClick={() => void toggle()}>
              {c.status === 'active' ? 'Deactivate' : 'Reactivate'}
            </button>
          </div>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
        <section className="card p-5">
          <h2 className="font-semibold">Details</h2>
          <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-6 gap-y-2.5 text-sm">
            <dt className="text-muted">Level</dt>
            <dd>{COURSE_LEVEL_LABEL[c.level]}</dd>
            <dt className="text-muted">Delivery</dt>
            <dd>{MODE_LABEL[c.deliveryMode]}</dd>
            <dt className="text-muted">Duration</dt>
            <dd>
              {durationText(c.durationValue, c.durationUnit)}
              {c.trainingHours ? `, ${c.trainingHours} training hours` : ''}
            </dd>
            <dt className="text-muted">To complete</dt>
            <dd>At least {c.attendanceThresholdPct}% attendance</dd>
            <dt className="text-muted">To pass</dt>
            <dd>{c.passMarkPct}% of total marks, and every required criterion passed</dd>
            <dt className="text-muted">Fee</dt>
            <dd>{c.feeRupees ? `₹${c.feeRupees.toLocaleString('en-IN')} (learners who enrol themselves pay it online)` : 'Free'}</dd>
            {c.track && c.trackStep && (
              <>
                <dt className="text-muted">Career journey</dt>
                <dd>
                  {TRACK_LABEL[c.track]}, step {c.trackStep} of 4 ({TRACK_STEP_LABEL[c.trackStep as TrackStep]}). Learners enrol and pay for the course; assign their batch in Course enrolments.
                </dd>
              </>
            )}
            <dt className="text-muted">Accommodation with food</dt>
            <dd>{c.stayAvailable ? (c.stayFeeRupees != null ? `Available, ₹${c.stayFeeRupees.toLocaleString('en-IN')} for the course` : 'Available, charge to be confirmed') : 'Not offered'}</dd>
            <dt className="text-muted">Prerequisites</dt>
            <dd className="whitespace-pre-line">{c.prerequisites || '—'}</dd>
            <dt className="text-muted">Description</dt>
            <dd className="whitespace-pre-line">{c.description || '—'}</dd>
          </dl>
        </section>

        <section className="card overflow-hidden">
          <div className="flex items-center justify-between border-b border-line px-5 py-4">
            <h2 className="font-semibold">Assessment criteria</h2>
            {manage &&
              (c.criteriaLocked ? (
                <span className="inline-flex items-center gap-1.5 text-sm text-muted">
                  <Lock className="size-4" aria-hidden />
                  Locked: a batch has started
                </span>
              ) : (
                <button className="btn-quiet btn-sm" onClick={() => setEditingCriteria(true)}>Edit criteria</button>
              ))}
          </div>
          <table className="w-full text-left text-sm">
            <thead className="bg-surface/60 text-[13px] text-muted">
              <tr>
                <th className="px-5 py-2.5 font-medium">Criterion</th>
                <th className="px-5 py-2.5 text-right font-medium">Max marks</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {c.criteria.map((x) => (
                <tr key={x.id}>
                  <td className="px-5 py-3">
                    {x.label}
                    {x.required && <span className="ml-2 rounded bg-brand-tint px-1.5 py-0.5 text-xs font-semibold text-brand">Required</span>}
                  </td>
                  <td className="px-5 py-3 text-right tabular-nums">{x.maxScore}</td>
                </tr>
              ))}
              <tr className="font-semibold">
                <td className="px-5 py-3">Total</td>
                <td className="px-5 py-3 text-right tabular-nums">{total}</td>
              </tr>
            </tbody>
          </table>
        </section>
      </div>

      {editing && <CourseModal course={c} onClose={() => setEditing(false)} />}
      {editingCriteria && <CriteriaModal course={c} onClose={() => setEditingCriteria(false)} />}
    </div>
  );
}

function CriteriaEditor({ value, onChange, errors }: { value: Criterion[]; onChange: (v: Criterion[]) => void; errors: Record<string, string> }) {
  const upd = (i: number, patch: Partial<Criterion>) => onChange(value.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  return (
    <div>
      <ul className="space-y-2">
        {value.map((c, i) => (
          <li key={i} className="grid grid-cols-[1fr_88px_auto_auto] items-start gap-2">
            <div>
              <label className="sr-only" htmlFor={`cr-${i}`}>Criterion {i + 1}</label>
              <input id={`cr-${i}`} className="field-input" placeholder="For example, Engine servicing" value={c.label} onChange={(e) => upd(i, { label: e.target.value })} />
              {errors[`criteria.${i}.label`] && <p className="field-error">{errors[`criteria.${i}.label`]}</p>}
            </div>
            <div>
              <label className="sr-only" htmlFor={`cm-${i}`}>Max marks for criterion {i + 1}</label>
              <input id={`cm-${i}`} type="number" min={1} className="field-input" value={c.maxScore} onChange={(e) => upd(i, { maxScore: Number(e.target.value) })} />
            </div>
            <label className="flex h-11 items-center gap-1.5 text-sm">
              <input type="checkbox" className="size-4 accent-[var(--color-brand)]" checked={c.required} onChange={(e) => upd(i, { required: e.target.checked })} />
              Required
            </label>
            <button type="button" className="grid h-11 w-10 place-items-center rounded-lg text-muted hover:bg-surface hover:text-brand disabled:opacity-40" disabled={value.length === 1} onClick={() => onChange(value.filter((_, j) => j !== i))} aria-label={`Remove criterion ${i + 1}`}>
              <Trash2 className="size-4" />
            </button>
          </li>
        ))}
      </ul>
      {errors.criteria && <p className="field-error">{errors.criteria}</p>}
      <button type="button" className="btn-quiet btn-sm mt-3" onClick={() => onChange([...value, { label: '', maxScore: 10, required: false }])}>
        <Plus className="size-4" aria-hidden />
        Add criterion
      </button>
      <p className="mt-2 text-[13px] text-muted">A required criterion must be passed for the course to be passed, whatever the total.</p>
    </div>
  );
}

const createSchema = courseSchema.extend({ criteria: criteriaListSchema.shape.criteria });

function CourseModal({ course, onClose }: { course?: CourseDetail; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const f = useForm(course ? courseSchema.partial() : createSchema);
  const locked = course?.criteriaLocked ?? false;
  const [v, setV] = useState({
    title: course?.title ?? '',
    code: course?.code ?? '',
    skillArea: course?.skillArea ?? '2W',
    level: course?.level ?? 'beginner',
    deliveryMode: course?.deliveryMode ?? 'classroom',
    durationValue: String(course?.durationValue ?? 3),
    durationUnit: course?.durationUnit ?? 'months',
    trainingHours: course?.trainingHours ? String(course.trainingHours) : '',
    attendanceThresholdPct: String(course?.attendanceThresholdPct ?? 75),
    passMarkPct: String(course?.passMarkPct ?? 60),
    feeRupees: String(course?.feeRupees ?? 0),
    prerequisites: course?.prerequisites ?? '',
    description: course?.description ?? '',
  });
  const [stay, setStay] = useState({ available: course?.stayAvailable ?? false, fee: course?.stayFeeRupees != null ? String(course.stayFeeRupees) : '' });
  const [criteria, setCriteria] = useState<Criterion[]>([{ label: '', maxScore: 50, required: true }]);
  const upd = (k: keyof typeof v) => (e: { target: { value: string } }) => setV({ ...v, [k]: e.target.value });
  const err = f.errors;

  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={course ? `Edit ${course.title}` : 'Add course'}
      footer={
        <>
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" type="submit" form="course-form" disabled={f.submitting}>{course ? 'Save changes' : 'Add course'}</button>
        </>
      }
    >
      <form
        id="course-form"
        noValidate
        className="max-h-[60dvh] space-y-4 overflow-y-auto pr-1"
        onSubmit={(e) => {
          e.preventDefault();
          const body: Record<string, unknown> = Object.fromEntries(Object.entries(v).filter(([, x]) => x !== ''));
          body.stayAvailable = stay.available;
          body.stayFeeRupees = stay.available && stay.fee !== '' ? stay.fee : null;
          if (!course) body.criteria = criteria;
          void f.submit(body, async (data) => {
            if (course) {
              await api.patch(`/admin/courses/${course.id}`, data);
              await qc.invalidateQueries({ queryKey: ['course'] });
              await qc.invalidateQueries({ queryKey: ['courses'] });
              toast('success', 'Course updated');
              onClose();
            } else {
              const res = await api.post<{ id: string }>('/admin/courses', data);
              await qc.invalidateQueries({ queryKey: ['courses'] });
              toast('success', 'Course added');
              navigate(`/admin/courses/${res.id}`);
            }
          });
        }}
      >
        {f.formError && <ErrorNote message={f.formError} />}
        <div className="grid gap-4 sm:grid-cols-[1fr_180px]">
          <Field label="Course title" htmlFor="co-title" error={err.title}>
            <input id="co-title" autoFocus className="field-input" value={v.title} onChange={upd('title')} />
          </Field>
          <Field label="Code (optional)" htmlFor="co-code" error={err.code}>
            <input id="co-code" className="field-input uppercase" placeholder="2W-ST-01" value={v.code} onChange={upd('code')} />
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Skill area" htmlFor="co-skill" error={err.skillArea}>
            <select id="co-skill" className="field-input" value={v.skillArea} onChange={upd('skillArea')}>
              {SKILL_AREAS.map((s) => <option key={s} value={s}>{SKILL_AREA_LABEL[s]}</option>)}
            </select>
          </Field>
          <Field label="Level" htmlFor="co-level" error={err.level}>
            <select id="co-level" className="field-input" value={v.level} onChange={upd('level')}>
              {COURSE_LEVELS.map((s) => <option key={s} value={s}>{COURSE_LEVEL_LABEL[s]}</option>)}
            </select>
          </Field>
          <Field label="Delivery" htmlFor="co-mode" error={err.deliveryMode}>
            <select id="co-mode" className="field-input" value={v.deliveryMode} onChange={upd('deliveryMode')}>
              {DELIVERY_MODES.map((s) => <option key={s} value={s}>{MODE_LABEL[s]}</option>)}
            </select>
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Duration" htmlFor="co-dur" error={err.durationValue}>
            <input id="co-dur" type="number" min={1} className="field-input" value={v.durationValue} onChange={upd('durationValue')} />
          </Field>
          <Field label="Unit" htmlFor="co-unit" error={err.durationUnit}>
            <select id="co-unit" className="field-input" value={v.durationUnit} onChange={upd('durationUnit')}>
              {DURATION_UNITS.map((s) => <option key={s} value={s}>{s[0]!.toUpperCase() + s.slice(1)}</option>)}
            </select>
          </Field>
          <Field label="Training hours (optional)" htmlFor="co-hours" error={err.trainingHours}>
            <input id="co-hours" type="number" min={1} className="field-input" value={v.trainingHours} onChange={upd('trainingHours')} />
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Attendance needed to complete (%)" htmlFor="co-att" error={err.attendanceThresholdPct} hint={locked ? 'Locked: a batch has started' : undefined}>
            <input id="co-att" type="number" min={0} max={100} disabled={locked} className="field-input" value={v.attendanceThresholdPct} onChange={upd('attendanceThresholdPct')} />
          </Field>
          <Field label="Pass mark (% of total)" htmlFor="co-pass" error={err.passMarkPct} hint={locked ? 'Locked: a batch has started' : undefined}>
            <input id="co-pass" type="number" min={0} max={100} disabled={locked} className="field-input" value={v.passMarkPct} onChange={upd('passMarkPct')} />
          </Field>
        </div>
        <Field label="Course fee (₹)" htmlFor="co-fee" error={err.feeRupees} hint="What a learner pays to enrol online. 0 makes the course free. No GST is added.">
          <input id="co-fee" type="number" min={0} step={1} className="field-input sm:max-w-[240px]" value={v.feeRupees} onChange={upd('feeRupees')} />
        </Field>
        <StayFields available={stay.available} fee={stay.fee} error={err.stayFeeRupees} onChange={setStay} />
        <Field label="Prerequisites (optional)" htmlFor="co-pre" error={err.prerequisites}>
          <textarea id="co-pre" rows={2} className="field-input h-auto py-2" value={v.prerequisites} onChange={upd('prerequisites')} />
        </Field>
        <Field label="Description (optional)" htmlFor="co-desc" error={err.description}>
          <textarea id="co-desc" rows={3} className="field-input h-auto py-2" value={v.description} onChange={upd('description')} />
        </Field>
        {!course && (
          <fieldset className="rounded-xl border border-line p-4">
            <legend className="px-1 text-sm font-semibold">Assessment criteria</legend>
            <CriteriaEditor value={criteria} onChange={setCriteria} errors={err} />
          </fieldset>
        )}
      </form>
    </Modal>
  );
}

function CriteriaModal({ course, onClose }: { course: CourseDetail; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const f = useForm(criteriaListSchema);
  const [criteria, setCriteria] = useState<Criterion[]>(course.criteria.map(({ label, maxScore, required }) => ({ label, maxScore, required })));
  return (
    <Modal
      open
      wide
      onClose={onClose}
      title="Edit assessment criteria"
      footer={
        <>
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" type="submit" form="criteria-form" disabled={f.submitting}>Save criteria</button>
        </>
      }
    >
      <form
        id="criteria-form"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void f.submit({ criteria }, async (data) => {
            await api.put(`/admin/courses/${course.id}/criteria`, data);
            await qc.invalidateQueries({ queryKey: ['course'] });
            await qc.invalidateQueries({ queryKey: ['courses'] });
            toast('success', 'Criteria saved');
            onClose();
          });
        }}
      >
        {f.formError && <div className="mb-4"><ErrorNote message={f.formError} /></div>}
        <CriteriaEditor value={criteria} onChange={setCriteria} errors={f.errors} />
        <p className="mt-4 text-[13px] text-muted">Criteria lock when the first batch of this course starts, so every result is marked against the same list.</p>
      </form>
    </Modal>
  );
}
