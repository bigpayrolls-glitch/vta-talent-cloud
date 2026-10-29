import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CERTIFICATE_TYPES,
  COURSE_APPROVAL_LABEL,
  COURSE_APPROVAL_STATUSES,
  COURSE_CATEGORY_LABEL,
  COURSE_DESCRIPTION_MAX,
  COURSE_IMAGE_MAX_BYTES,
  COURSE_LEVEL_LABEL,
  COURSE_LEVELS,
  COURSE_TYPE_LABEL,
  COURSE_TYPES,
  DELIVERY_MODE_LABEL,
  DELIVERY_MODES,
  DURATION_UNITS,
  feeWithGst,
  firstBatchSchema,
  GST_RATES,
  partnerCourseContentSchema,
  partnerCourseDetailsSchema,
  SKILL_AREAS,
  SUGGESTED_SKILLS,
  type Page,
  type PartnerCourse,
  hoursLabel,
  minutesToHours,
} from '@vta/shared';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  ClipboardCheck,
  ImagePlus,
  IndianRupee,
  Pencil,
  Plus,
  Send,
  Trash2,
  Users,
  UsersRound,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { z } from 'zod';
import { SearchBox, Select } from '../../components/form';
import { StayFields } from '../../components/StayFields';
import { useToast } from '../../components/toast';
import { ADD_CENTRE, AddCentreModal } from '../../components/centre';
import { EmptyState, ErrorNote, Field, Modal, PageHeader, Pagination, Spinner, formatDate } from '../../components/ui';
import { api, ApiError, qs, uploadFile } from '../../lib/api';
import { firstName, useAuth } from '../../lib/auth';
import { useListParams } from '../../lib/useListParams';
import { CreateBatchModal } from '../training/Batches';
import { ApprovalBadge, BatchBadge, CourseSummary, CourseThumb, fmtDay, HistoryList, rupees } from './courseParts';

/**
 * Training partner: course creation and approval journey (wireframe of 27 Oct 2026).
 * Dashboard → Courses list → Create course (4 steps) → Submit for admin review → Course management.
 */

interface CourseBatch {
  id: string;
  name: string;
  status: string;
  startDate: string;
  endDate: string;
  capacity: number;
  enrolled: number;
  classTimings: string | null;
  centre: string;
  city: string | null;
  trainer: string;
}
interface CourseDetail extends PartnerCourse {
  history: { action: string; note: string | null; actor: string | null; at: string }[];
  batches: CourseBatch[];
  editable: boolean;
}
interface Dashboard {
  courses: { total: number; published: number; inReview: number; needsAction: number };
  batches: { total: number; ongoing: number; upcoming: number };
  enrolments: number;
  revenueRupees: number;
  activity: { kind: 'course' | 'enrolment' | 'batch'; text: string; at: string; link: string }[];
}

// ====================================================================== screen 1: dashboard

export function PartnerDashboard() {
  const { me } = useAuth();
  const q = useQuery({ queryKey: ['partner-dashboard'], queryFn: () => api.get<Dashboard>('/partner/dashboard') });
  const org = me?.roles.find((r) => r.role === 'partner_admin')?.organisationName;
  return (
    <div>
      <section className="flex flex-wrap items-center justify-between gap-4 rounded-[20px] bg-brand-tint px-6 py-7 sm:px-10">
        <div>
          <h1 className="text-[28px] font-extrabold tracking-tight sm:text-[32px]">Welcome back, {firstName(me?.name ?? '')}</h1>
          <p className="mt-1 text-ink/75">{org ? `${org} · ` : ''}Here’s an overview of your training activities.</p>
        </div>
        <Link to="/partner/courses/new" className="btn-primary">
          <Plus className="size-4" aria-hidden />
          Create course
        </Link>
      </section>

      {q.isLoading && <Spinner />}
      {q.isError && <div className="mt-6"><ErrorNote message={(q.error as Error).message} /></div>}
      {q.data && (
        <>
          <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat icon={BookOpen} label="Courses" value={q.data.courses.total} note={`${q.data.courses.published} published, ${q.data.courses.inReview} in review`} to="/partner/courses" />
            <Stat icon={UsersRound} label="Batches" value={q.data.batches.total} note={`${q.data.batches.ongoing} ongoing, ${q.data.batches.upcoming} upcoming`} to="/partner/batches" />
            <Stat icon={Users} label="Enrolments" value={q.data.enrolments} note="Learners in your batches" />
            <Stat icon={IndianRupee} label="Total revenue" value={q.data.revenueRupees} money note="Course fees paid online, incl. GST" />
          </div>

          {q.data.courses.needsAction > 0 && (
            <Link to="/partner/courses?approvalStatus=changes_requested" className="card mt-4 flex items-center gap-3 border-warning/40 bg-warning-tint px-5 py-3 text-sm">
              <AlertTriangle className="size-5 text-warning" aria-hidden />
              <span className="flex-1">
                <span className="font-semibold">{q.data.courses.needsAction} {q.data.courses.needsAction === 1 ? 'course needs' : 'courses need'} your attention</span> — drafts to finish or changes AutoTalent Grid asked for.
              </span>
              <ArrowRight className="size-4 text-warning" aria-hidden />
            </Link>
          )}

          <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_320px]">
            <section className="card">
              <div className="flex items-center justify-between border-b border-line px-5 py-4">
                <h2 className="font-bold">Recent activities</h2>
              </div>
              {q.data.activity.length === 0 ? (
                <EmptyState title="Nothing yet" body="Create your first course. When AutoTalent Grid approves it, enrolments show up here." />
              ) : (
                <ul className="divide-y divide-line">
                  {q.data.activity.map((a, i) => (
                    <li key={i}>
                      <Link to={a.link} className="flex items-start gap-3 px-5 py-3 hover:bg-surface/60">
                        <span className={`mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg ${a.kind === 'course' ? 'bg-brand-tint text-brand' : a.kind === 'enrolment' ? 'bg-success-tint text-success' : 'bg-info-tint text-info'}`}>
                          {a.kind === 'course' ? <BookOpen className="size-4" aria-hidden /> : a.kind === 'enrolment' ? <Users className="size-4" aria-hidden /> : <UsersRound className="size-4" aria-hidden />}
                        </span>
                        <span className="min-w-0 flex-1 text-sm">{a.text}</span>
                        <span className="shrink-0 text-xs text-muted">{formatDate(a.at)}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section className="card px-5 py-5">
              <h2 className="font-bold">How publishing works</h2>
              <ol className="mt-3 space-y-3 text-sm">
                {['Create the course in four steps', 'Submit it for admin review', 'AutoTalent Grid approves and publishes it', 'Learners see it and enrol; you run the batches'].map((t, i) => (
                  <li key={t} className="flex gap-3">
                    <span className="grid size-6 shrink-0 place-items-center rounded-full bg-brand text-xs font-bold text-white">{i + 1}</span>
                    <span>{t}</span>
                  </li>
                ))}
              </ol>
              <p className="mt-4 rounded-lg bg-surface px-3 py-2 text-xs text-muted">A course is not visible to learners until it is reviewed, approved and published by AutoTalent Grid.</p>
            </section>
          </div>
        </>
      )}
    </div>
  );
}

function Stat({ icon: Icon, label, value, note, to, money = false }: { icon: typeof BookOpen; label: string; value: number; note?: string; to?: string; money?: boolean }) {
  const body = (
    <>
      <span className="grid size-10 place-items-center rounded-xl bg-brand-tint text-brand"><Icon className="size-5" aria-hidden /></span>
      <p className="mt-3 text-[26px] font-bold leading-none tracking-tight">{money ? rupees(value) : value.toLocaleString('en-IN')}</p>
      <p className="mt-1.5 text-sm font-medium">{label}</p>
      {note && <p className="text-xs text-muted">{note}</p>}
    </>
  );
  return to ? <Link to={to} className="card block px-5 py-4 transition-colors hover:border-brand">{body}</Link> : <div className="card px-5 py-4">{body}</div>;
}

// ====================================================================== screen 2: courses list

export function PartnerCoursesPage() {
  const { values, page, set, setPage } = useListParams(['q', 'skillArea', 'approvalStatus'] as const);
  const q = useQuery({
    queryKey: ['partner-courses', values, page],
    queryFn: () => api.get<Page<PartnerCourse> & { counts: Record<string, number> }>(`/partner/courses${qs({ ...values, page, pageSize: 20 })}`),
    placeholderData: (p) => p,
  });
  return (
    <div>
      <PageHeader
        title="Courses"
        description="Courses your organisation offers. New courses go live after AutoTalent Grid approves them."
        actions={
          <Link to="/partner/courses/new" className="btn-primary">
            <Plus className="size-4" aria-hidden />
            Create course
          </Link>
        }
      />
      <div className="mb-4 flex flex-col gap-3 md:flex-row">
        <SearchBox initial={values.q} onSearch={(v) => set('q', v)} placeholder="Search courses" label="Search courses" />
        <div className="flex gap-3">
          <Select id="pc-cat" label="Category" className="md:w-44" value={values.skillArea} onChange={(v) => set('skillArea', v)} options={[{ value: '', label: 'All categories' }, ...SKILL_AREAS.map((s) => ({ value: s, label: COURSE_CATEGORY_LABEL[s] }))]} />
          <Select
            id="pc-status"
            label="Status"
            className="md:w-52"
            value={values.approvalStatus}
            onChange={(v) => set('approvalStatus', v)}
            options={[{ value: '', label: 'All statuses' }, ...COURSE_APPROVAL_STATUSES.map((s) => ({ value: s, label: `${COURSE_APPROVAL_LABEL[s]}${q.data?.counts[s] ? ` (${q.data.counts[s]})` : ''}` }))]}
          />
        </div>
      </div>
      <div className="card overflow-hidden">
        {q.isLoading ? (
          <Spinner />
        ) : q.isError ? (
          <div className="p-4"><ErrorNote message={(q.error as Error).message} /></div>
        ) : q.data!.items.length === 0 ? (
          <EmptyState title="No courses yet" body="Create a course, then submit it for review." action={<Link to="/partner/courses/new" className="btn-primary">Create course</Link>} />
        ) : (
          <>
            <div className="hidden grid-cols-[1fr_140px_130px_190px_96px] gap-4 border-b border-line bg-surface/60 px-5 py-2.5 text-xs font-semibold uppercase tracking-wide text-muted md:grid">
              <span>Course name</span>
              <span>Category</span>
              <span>Fee</span>
              <span>Status</span>
              <span className="text-right">Actions</span>
            </div>
            <ul className="divide-y divide-line">
              {q.data!.items.map((c) => (
                <li key={c.id} className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-2 px-5 py-3.5 md:grid-cols-[1fr_140px_130px_190px_96px]">
                  <Link to={`/partner/courses/${c.id}`} className="col-start-1 row-start-1 flex min-w-0 items-center gap-3 hover:text-brand md:col-auto md:row-auto">
                    <CourseThumb c={c} className="size-12" />
                    <span className="min-w-0">
                      <span className="block truncate font-semibold">{c.title}</span>
                      <span className="block text-xs text-muted">
                        {c.batchCount ?? 0} {c.batchCount === 1 ? 'batch' : 'batches'} · {c.enrolled ?? 0} enrolled · updated {formatDate(c.updatedAt)}
                      </span>
                    </span>
                  </Link>
                  <span className="hidden text-sm md:block">{COURSE_CATEGORY_LABEL[c.skillArea]}</span>
                  <span className="hidden text-sm md:block">
                    {c.totalFeeRupees ? rupees(c.totalFeeRupees) : 'Free'}
                    {c.totalFeeRupees > 0 && c.gstPct > 0 && <span className="block text-xs text-muted">incl. {c.gstPct}% GST</span>}
                  </span>
                  <span className="col-start-1 row-start-2 md:col-auto md:row-auto"><ApprovalBadge status={c.approvalStatus} active={c.active} /></span>
                  <span className="col-start-2 row-start-1 flex justify-end gap-1 md:col-auto md:row-auto">
                    {(c.approvalStatus === 'draft' || c.approvalStatus === 'changes_requested') && (
                      <Link to={`/partner/courses/${c.id}/edit`} className="rounded-lg p-2 text-muted hover:bg-surface hover:text-brand" aria-label={`Edit ${c.title}`} title="Edit">
                        <Pencil className="size-4" />
                      </Link>
                    )}
                    <Link to={`/partner/courses/${c.id}`} className="rounded-lg p-2 text-muted hover:bg-surface hover:text-brand" aria-label={`Open ${c.title}`} title="Open">
                      <ArrowRight className="size-4" />
                    </Link>
                  </span>
                </li>
              ))}
            </ul>
            <Pagination page={q.data!.page} pageSize={q.data!.pageSize} total={q.data!.total} onPage={setPage} />
          </>
        )}
      </div>
    </div>
  );
}

// ====================================================================== screens 3–6: the wizard

const STEPS = ['Basic details', 'Course content', 'Fee & batch', 'Review & submit'] as const;

interface WizardValues {
  title: string;
  skillArea: string;
  courseType: string;
  level: string;
  description: string;
  city: string;
  deliveryMode: string;
  durationValue: string;
  durationUnit: string;
  modules: { name: string; hours: string; theoryHours?: string; practicalHours?: string }[];
  skills: string[];
  prerequisites: string;
  learningOutcomes: string[];
  feeRupees: string;
  gstPct: string;
  certificateType: string;
  stayAvailable: boolean;
  stayFeeRupees: string;
  batch: { name: string; centreId: string; trainerId: string; startDate: string; endDate: string; capacity: string; classTimings: string };
}

const EMPTY: WizardValues = {
  title: '',
  skillArea: '',
  courseType: '',
  level: '',
  description: '',
  city: '',
  deliveryMode: '',
  durationValue: '',
  durationUnit: 'weeks',
  modules: [],
  skills: [],
  prerequisites: '',
  learningOutcomes: [],
  feeRupees: '',
  gstPct: '18',
  certificateType: '',
  stayAvailable: false,
  stayFeeRupees: '',
  batch: { name: '', centreId: '', trainerId: '', startDate: '', endDate: '', capacity: '25', classTimings: '' },
};

function fromCourse(c: PartnerCourse): WizardValues {
  return {
    title: c.title,
    skillArea: c.skillArea,
    courseType: c.courseType ?? '',
    level: c.level,
    description: c.description ?? '',
    city: c.city ?? '',
    deliveryMode: c.deliveryMode,
    durationValue: String(c.durationValue),
    durationUnit: c.durationUnit,
    modules: c.modules.map((m) => ({ name: m.name, hours: String(m.hours), ...(m.theoryHours !== undefined || m.practicalHours !== undefined ? { theoryHours: String(m.theoryHours ?? 0), practicalHours: String(m.practicalHours ?? 0) } : {}) })),
    skills: c.skills,
    prerequisites: c.prerequisites ?? '',
    learningOutcomes: c.learningOutcomes,
    feeRupees: String(c.feeRupees),
    gstPct: String(c.gstPct),
    certificateType: c.certificateType ?? '',
    stayAvailable: c.stayAvailable,
    stayFeeRupees: c.stayFeeRupees === null ? '' : String(c.stayFeeRupees),
    batch: c.firstBatch
      ? { name: c.firstBatch.name, centreId: c.firstBatch.centreId, trainerId: c.firstBatch.trainerId, startDate: c.firstBatch.startDate, endDate: c.firstBatch.endDate, capacity: String(c.firstBatch.capacity), classTimings: c.firstBatch.classTimings ?? '' }
      : EMPTY.batch,
  };
}

const feeStepSchema = z.object({
  feeRupees: z.coerce.number().int('Whole rupees only').min(0, 'Cannot be negative').max(500_000, 'At most ₹5,00,000'),
  gstPct: z.coerce.number(),
  certificateType: z.string().min(1, 'Choose a certificate type'),
  firstBatch: firstBatchSchema.nullable(),
  stayAvailable: z.boolean(),
  stayFeeRupees: z.coerce.number().int('Whole rupees only').min(0, 'Cannot be negative').max(200_000, 'At most ₹2,00,000').nullable(),
});

/** Field errors keyed by server field names, mapped to the step that holds them. */
const STEP_OF: Record<string, number> = {
  title: 1, skillArea: 1, courseType: 1, level: 1, description: 1, city: 1, deliveryMode: 1, durationValue: 1, image: 1,
  modules: 2, skills: 2, prerequisites: 2, learningOutcomes: 2,
  feeRupees: 3, gstPct: 3, certificateType: 3, firstBatch: 3, stayAvailable: 3, stayFeeRupees: 3,
};
const stepOf = (k: string) => STEP_OF[k.split('.')[0]!] ?? 1;

export function CourseWizardPage() {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const step = id ? Math.min(4, Math.max(1, Number(params.get('step') ?? 1) || 1)) : 1;
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const course = useQuery({ queryKey: ['partner-course', id], enabled: !!id, queryFn: () => api.get<CourseDetail>(`/partner/courses/${id}`) });
  const [v, setV] = useState<WizardValues>(EMPTY);
  const [loadedId, setLoadedId] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const [image, setImage] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  useEffect(() => {
    if (course.data && loadedId !== course.data.id) {
      setV(fromCourse(course.data));
      setLoadedId(course.data.id);
    }
  }, [course.data, loadedId]);
  useEffect(() => {
    if (!image) return setPreview(null);
    const url = URL.createObjectURL(image);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [image]);

  if (id && course.isLoading) return <Spinner />;
  if (id && course.isError) return <ErrorNote message={(course.error as Error).message} />;
  if (course.data && !course.data.editable) {
    return (
      <div className="card mx-auto max-w-xl px-6 py-8 text-center">
        <p className="font-semibold">This course cannot be changed now.</p>
        <p className="mt-1 text-sm text-muted">It is {COURSE_APPROVAL_LABEL[course.data.approvalStatus].toLowerCase()}.</p>
        <Link to={`/partner/courses/${course.data.id}`} className="btn-secondary mt-4">Open the course</Link>
      </div>
    );
  }

  const goStep = (n: number, courseId = id) => {
    if (courseId && courseId !== id) navigate(`/partner/courses/${courseId}/edit?step=${n}`);
    else setParams({ step: String(n) });
    window.scrollTo({ top: 0 });
  };

  const fail = (e: unknown) => {
    if (e instanceof ApiError) {
      setErrors(e.fields);
      setFormError(e.message);
    } else setFormError('Something went wrong. Please try again.');
  };

  const local = (schema: z.ZodType, values: unknown, prefix = ''): boolean => {
    const r = schema.safeParse(values);
    if (r.success) return true;
    const next: Record<string, string> = {};
    for (const i of r.error.issues) next[prefix + i.path.join('.')] ??= i.message;
    setErrors(next);
    setFormError('Check the highlighted fields.');
    return false;
  };

  /** Saves the current step; returns the course id. */
  async function save(): Promise<string | null> {
    setErrors({});
    setFormError('');
    if (step === 1) {
      const body = { title: v.title, skillArea: v.skillArea, courseType: v.courseType, level: v.level, description: v.description, city: v.city, deliveryMode: v.deliveryMode, durationValue: v.durationValue, durationUnit: v.durationUnit };
      if (!local(partnerCourseDetailsSchema, body)) return null;
      if (image && image.size > COURSE_IMAGE_MAX_BYTES) {
        setErrors({ image: 'The image must be 2 MB or smaller' });
        return null;
      }
      const courseId = id ?? (await api.post<{ id: string }>('/partner/courses', body)).id;
      if (id) await api.patch(`/partner/courses/${id}`, body);
      if (image) {
        try {
          await uploadFile(`/partner/courses/${courseId}/image`, image);
          setImage(null);
        } catch (e) {
          if (!id) navigate(`/partner/courses/${courseId}/edit?step=1`, { replace: true });
          throw e;
        }
      }
      return courseId;
    }
    if (step === 2) {
      const body = {
        modules: v.modules.filter((m) => m.name.trim() || m.hours).map((m) => (m.theoryHours !== undefined || m.practicalHours !== undefined ? { name: m.name, theoryHours: m.theoryHours ?? '0', practicalHours: m.practicalHours ?? '0' } : { name: m.name, hours: m.hours })),
        skills: v.skills,
        prerequisites: v.prerequisites,
        learningOutcomes: v.learningOutcomes.map((o) => o.trim()).filter(Boolean),
      };
      if (!local(partnerCourseContentSchema, body)) return null;
      await api.patch(`/partner/courses/${id}`, body);
      return id!;
    }
    if (step === 3) {
      const b = v.batch;
      const anyBatch = Object.entries(b).some(([k, x]) => k !== 'capacity' && x.trim());
      const body = {
        feeRupees: v.feeRupees === '' ? 0 : v.feeRupees,
        gstPct: Number(v.gstPct),
        certificateType: v.certificateType,
        stayAvailable: v.stayAvailable,
        stayFeeRupees: v.stayAvailable && v.stayFeeRupees !== '' ? v.stayFeeRupees : null,
        firstBatch: anyBatch ? { ...b, classTimings: b.classTimings || undefined } : null,
      };
      if (!local(feeStepSchema, body)) return null;
      await api.patch(`/partner/courses/${id}`, body);
      return id!;
    }
    return id!;
  }

  async function next(exit = false) {
    setBusy(true);
    try {
      const courseId = await save();
      if (!courseId) return;
      await qc.invalidateQueries({ queryKey: ['partner-course', courseId] });
      await qc.invalidateQueries({ queryKey: ['partner-courses'] });
      if (exit) {
        toast('success', 'Draft saved');
        navigate(`/partner/courses/${courseId}`);
      } else goStep(step + 1, courseId);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    setBusy(true);
    setErrors({});
    setFormError('');
    try {
      await api.post(`/partner/courses/${id}/submit`);
      await qc.invalidateQueries({ queryKey: ['partner-course', id] });
      await qc.invalidateQueries({ queryKey: ['partner-courses'] });
      await qc.invalidateQueries({ queryKey: ['partner-dashboard'] });
      toast('success', 'Submitted for admin review');
      navigate(`/partner/courses/${id}?submitted=1`);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }

  const set = <K extends keyof WizardValues>(k: K, val: WizardValues[K]) => setV((p) => ({ ...p, [k]: val }));

  return (
    <div className="mx-auto max-w-4xl">
      <Link to={id ? `/partner/courses/${id}` : '/partner/courses'} className="inline-flex items-center gap-1 text-sm text-muted hover:text-brand">
        <ArrowLeft className="size-4" aria-hidden /> Back to courses
      </Link>
      <h1 className="mt-2 text-[26px] font-bold tracking-tight">{id ? `Edit course` : 'Create course'}</h1>
      {course.data?.approvalStatus === 'changes_requested' && course.data.reviewNote && (
        <div className="mt-4 flex gap-3 rounded-xl border border-brand/30 bg-brand-tint px-4 py-3 text-sm">
          <AlertTriangle className="size-5 shrink-0 text-brand" aria-hidden />
          <span><span className="font-semibold">AutoTalent Grid asked for changes:</span> {course.data.reviewNote}</span>
        </div>
      )}

      <Stepper step={step} canJump={!!id} onJump={(n) => goStep(n)} />

      <div className="card mt-5 px-5 py-6 sm:px-8">
        {formError && <div className="mb-5"><ErrorNote message={formError} /></div>}
        {step === 1 && <StepDetails v={v} set={set} errors={errors} image={image} setImage={setImage} preview={preview ?? course.data?.imageUrl ?? null} />}
        {step === 2 && <StepContent v={v} set={set} errors={errors} />}
        {step === 3 && <StepFee v={v} set={set} errors={errors} />}
        {step === 4 && course.data && (
          <>
            <h2 className="mb-1 text-lg font-bold">Review & submit</h2>
            <p className="mb-5 text-sm text-muted">Check everything once. After you submit, AutoTalent Grid reviews the course; you cannot change it while it is in review.</p>
            {Object.keys(errors).length > 0 && (
              <div className="mb-5 rounded-xl border border-brand/30 bg-brand-tint px-4 py-3 text-sm">
                <p className="font-semibold text-brand">Still missing</p>
                <ul className="mt-1 space-y-1">
                  {Object.entries(errors).map(([k, msg]) => (
                    <li key={k} className="flex items-center justify-between gap-3">
                      <span>{msg}</span>
                      <button type="button" className="font-semibold text-brand underline" onClick={() => goStep(stepOf(k))}>Fix in step {stepOf(k)}</button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="space-y-6">
              {(['details', 'content', 'fee'] as const).map((s, i) => (
                <section key={s} className="rounded-xl border border-line p-4 sm:p-5">
                  <div className="mb-4 flex items-center justify-between">
                    <h3 className="font-semibold">{STEPS[i]}</h3>
                    <button type="button" className="btn-secondary btn-sm" onClick={() => goStep(i + 1)}>
                      <Pencil className="size-3.5" aria-hidden /> Edit
                    </button>
                  </div>
                  <CourseSummary c={course.data!} section={s} />
                </section>
              ))}
            </div>
            <p className="mt-6 flex gap-2 rounded-lg bg-surface px-4 py-3 text-sm text-muted">
              <ClipboardCheck className="size-5 shrink-0 text-brand" aria-hidden />
              This course will not be visible to learners until it is reviewed, approved and published by AutoTalent Grid.
            </p>
          </>
        )}

        <div className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-5">
          <div>
            {step > 1 && (
              <button type="button" className="btn-secondary" onClick={() => goStep(step - 1)} disabled={busy}>
                <ArrowLeft className="size-4" aria-hidden /> Back
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {step < 4 && (
              <>
                <button type="button" className="btn-secondary" onClick={() => void next(true)} disabled={busy}>Save draft</button>
                <button type="button" className="btn-primary" onClick={() => void next()} disabled={busy}>
                  {busy ? 'Saving…' : 'Save & continue'} <ArrowRight className="size-4" aria-hidden />
                </button>
              </>
            )}
            {step === 4 && (
              <button type="button" className="btn-primary" onClick={() => void submit()} disabled={busy}>
                <Send className="size-4" aria-hidden /> {busy ? 'Submitting…' : 'Submit for admin review'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Stepper({ step, canJump, onJump }: { step: number; canJump: boolean; onJump: (n: number) => void }) {
  return (
    <ol className="mt-5 grid grid-cols-4 gap-2" aria-label="Steps">
      {STEPS.map((label, i) => {
        const n = i + 1;
        const state = n < step ? 'done' : n === step ? 'current' : 'todo';
        const inner = (
          <>
            <span className={`grid size-8 shrink-0 place-items-center rounded-full text-sm font-bold ${state === 'todo' ? 'border border-line bg-white text-muted' : 'bg-brand text-white'}`}>
              {state === 'done' ? <Check className="size-4" aria-hidden /> : n}
            </span>
            <span className={`hidden text-sm sm:block ${state === 'current' ? 'font-semibold text-ink' : 'text-muted'}`}>{label}</span>
          </>
        );
        return (
          <li key={label} className="relative" aria-current={state === 'current' ? 'step' : undefined}>
            <div className={`mb-3 h-1 rounded-full ${n <= step ? 'bg-brand' : 'bg-line'}`} aria-hidden />
            {canJump && state !== 'current' ? (
              <button type="button" className="flex items-center gap-2 text-left" onClick={() => onJump(n)}>{inner}</button>
            ) : (
              <div className="flex items-center gap-2">{inner}</div>
            )}
            <span className="sr-only">{label}</span>
          </li>
        );
      })}
    </ol>
  );
}

type StepProps = { v: WizardValues; set: <K extends keyof WizardValues>(k: K, val: WizardValues[K]) => void; errors: Record<string, string> };

function Choice<T extends string>({ id, value, options, onChange, labels }: { id: string; value: string; options: readonly T[]; onChange: (v: T) => void; labels: Record<T, string> }) {
  return (
    <div id={id} role="radiogroup" className="flex flex-wrap gap-2">
      {options.map((o) => (
        <button
          key={o}
          type="button"
          role="radio"
          aria-checked={value === o}
          onClick={() => onChange(o)}
          className={`h-10 rounded-lg border px-4 text-sm font-medium transition-colors ${value === o ? 'border-brand bg-brand-tint text-brand' : 'border-line bg-white hover:bg-surface'}`}
        >
          {labels[o]}
        </button>
      ))}
    </div>
  );
}

function StepDetails({ v, set, errors, image, setImage, preview }: StepProps & { image: File | null; setImage: (f: File | null) => void; preview: string | null }) {
  const fileRef = useRef<HTMLInputElement>(null);
  return (
    <div>
      <h2 className="mb-5 text-lg font-bold">Basic details</h2>
      <div className="grid gap-5 md:grid-cols-2">
        <div className="md:col-span-2">
          <Field label="Course title" htmlFor="w-title" error={errors.title}>
            <input id="w-title" className="field-input" placeholder="For example, 2W Service Technician Advanced" value={v.title} onChange={(e) => set('title', e.target.value)} />
          </Field>
        </div>
        <Field label="Category" htmlFor="w-cat" error={errors.skillArea}>
          <select id="w-cat" className="field-input" value={v.skillArea} onChange={(e) => set('skillArea', e.target.value)}>
            <option value="">Choose a category</option>
            {SKILL_AREAS.map((s) => <option key={s} value={s}>{COURSE_CATEGORY_LABEL[s]}</option>)}
          </select>
        </Field>
        <Field label="Level" htmlFor="w-level" error={errors.level}>
          <select id="w-level" className="field-input" value={v.level} onChange={(e) => set('level', e.target.value)}>
            <option value="">Choose a level</option>
            {COURSE_LEVELS.map((s) => <option key={s} value={s}>{COURSE_LEVEL_LABEL[s]}</option>)}
          </select>
        </Field>
        <div className="md:col-span-2">
          <Field label="Course type" htmlFor="w-type" error={errors.courseType}>
            <Choice id="w-type" value={v.courseType} options={COURSE_TYPES} labels={COURSE_TYPE_LABEL} onChange={(x) => set('courseType', x)} />
          </Field>
        </div>
        <div className="md:col-span-2">
          <Field label="Description" htmlFor="w-desc" error={errors.description} hint={`${v.description.length}/${COURSE_DESCRIPTION_MAX} characters`}>
            <textarea id="w-desc" rows={4} maxLength={COURSE_DESCRIPTION_MAX} className="field-input h-auto py-2" placeholder="What learners will do and who the course is for" value={v.description} onChange={(e) => set('description', e.target.value)} />
          </Field>
        </div>
        <Field label="Location (city)" htmlFor="w-city" error={errors.city}>
          <input id="w-city" className="field-input" placeholder="For example, Bengaluru" value={v.city} onChange={(e) => set('city', e.target.value)} />
        </Field>
        <div className="grid grid-cols-[1fr_130px] gap-3">
          <Field label="Duration" htmlFor="w-dur" error={errors.durationValue}>
            <input id="w-dur" type="number" min={1} className="field-input" value={v.durationValue} onChange={(e) => set('durationValue', e.target.value)} />
          </Field>
          <Field label="Unit" htmlFor="w-unit">
            <select id="w-unit" className="field-input" value={v.durationUnit} onChange={(e) => set('durationUnit', e.target.value)}>
              {DURATION_UNITS.map((u) => <option key={u} value={u}>{u[0]!.toUpperCase() + u.slice(1)}</option>)}
            </select>
          </Field>
        </div>
        <div className="md:col-span-2">
          <Field label="Delivery mode" htmlFor="w-mode" error={errors.deliveryMode}>
            <Choice id="w-mode" value={v.deliveryMode} options={DELIVERY_MODES} labels={DELIVERY_MODE_LABEL} onChange={(x) => set('deliveryMode', x)} />
          </Field>
        </div>
        <div className="md:col-span-2">
          <Field label="Course image" htmlFor="w-image" error={errors.image} hint="JPG or PNG, up to 2 MB. Shown on the course card learners see.">
            <div className="flex items-center gap-4">
              {preview ? (
                <img src={preview} alt="Course image preview" className="h-24 w-40 rounded-xl border border-line object-cover" />
              ) : (
                <span className="grid h-24 w-40 place-items-center rounded-xl border-2 border-dashed border-line text-muted"><ImagePlus className="size-7" aria-hidden /></span>
              )}
              <div className="flex flex-col gap-2">
                <input ref={fileRef} id="w-image" type="file" accept="image/png,image/jpeg" className="sr-only" onChange={(e) => setImage(e.target.files?.[0] ?? null)} />
                <button type="button" className="btn-secondary btn-sm" onClick={() => fileRef.current?.click()}>
                  <ImagePlus className="size-4" aria-hidden /> {preview ? 'Change image' : 'Upload image'}
                </button>
                {image && <span className="text-xs text-muted">{image.name} ({Math.round(image.size / 1024)} KB) — uploads when you save</span>}
              </div>
            </div>
          </Field>
        </div>
      </div>
    </div>
  );
}

function StepContent({ v, set, errors }: StepProps) {
  const [skill, setSkill] = useState('');
  const [outcome, setOutcome] = useState('');
  const [editing, setEditing] = useState<number | null>(null);
  // Time can be typed in hours (0.5, 2) or minutes (30, 90); it is kept and shown in hours.
  // Hybrid courses split each module into theory and practical time; the total is their sum.
  const hybrid = v.deliveryMode === 'blended';
  const [draft, setDraft] = useState<{ name: string; amount: string; theory: string; practical: string; unit: 'hours' | 'minutes' }>({ name: '', amount: '', theory: '', practical: '', unit: 'hours' });
  const totalHours = Math.round(v.modules.reduce((n, m) => n + (Number(m.hours) || 0), 0) * 100) / 100;
  const toggleSkill = (s: string) => set('skills', v.skills.includes(s) ? v.skills.filter((x) => x !== s) : [...v.skills, s]);
  const toHours = (x: string) => (draft.unit === 'minutes' ? minutesToHours(Number(x) || 0) : Math.round((Number(x) || 0) * 100) / 100);
  const draftTheory = toHours(draft.theory);
  const draftPractical = toHours(draft.practical);
  const draftHours = hybrid ? Math.round((draftTheory + draftPractical) * 100) / 100 : toHours(draft.amount);
  const draftOk = !!draft.name.trim() && draftHours > 0;
  const saveModule = () => {
    if (!draftOk) return;
    const list = [...v.modules];
    const m = hybrid
      ? { name: draft.name.trim(), hours: String(draftHours), theoryHours: String(draftTheory), practicalHours: String(draftPractical) }
      : { name: draft.name.trim(), hours: String(draftHours) };
    if (editing !== null && editing < list.length) list[editing] = m;
    else list.push(m);
    set('modules', list);
    setDraft({ name: '', amount: '', theory: '', practical: '', unit: draft.unit });
    setEditing(null);
  };
  const totalTheory = Math.round(v.modules.reduce((n, m) => n + (Number(m.theoryHours) || 0), 0) * 100) / 100;
  const totalPractical = Math.round(v.modules.reduce((n, m) => n + (Number(m.practicalHours) || 0), 0) * 100) / 100;
  /** The first message for a part of this step, from either the browser check or the server. */
  const errorFor = (key: string) => Object.entries(errors).find(([k]) => k === key || k.startsWith(`${key}.`))?.[1];

  return (
    <div className="space-y-7">
      <h2 className="text-lg font-bold">Add course content</h2>
      <section>
        <div className="mb-2 flex items-end justify-between">
          <h3 className="font-semibold">Course modules</h3>
          <span className="text-right text-sm text-muted">
            Total {totalHours} hours
            {hybrid && totalHours > 0 && <span className="block text-xs">{totalTheory} h theory + {totalPractical} h practical</span>}
          </span>
        </div>
        {hybrid && <p className="mb-2 text-sm text-muted">Hybrid course: enter the theory and practical time of each module. The total is added up for you.</p>}
        {errorFor('modules') && <p className="field-error mb-2" role="alert">{errorFor('modules')}</p>}
        <div className="overflow-hidden rounded-xl border border-line">
          <table className="w-full text-sm">
            <thead className="bg-surface/70 text-left text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="w-10 px-3 py-2">#</th>
                <th className="px-3 py-2">Module name</th>
                <th className="w-28 px-3 py-2">Time</th>
                <th className="w-24 px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {v.modules.map((m, i) => (
                <tr key={i} className={errorFor(`modules.${i}`) ? 'bg-brand-tint' : undefined}>
                  <td className="px-3 py-2.5 text-muted">{i + 1}</td>
                  <td className="px-3 py-2.5">
                    {m.name}
                    {errorFor(`modules.${i}`) && <span className="field-error block">{errorFor(`modules.${i}`)}</span>}
                  </td>
                  <td className="px-3 py-2.5">
                    {Number(m.hours) > 0 ? hoursLabel(Number(m.hours)) : m.hours}
                    {m.theoryHours !== undefined && (
                      <span className="block whitespace-nowrap text-xs text-muted">
                        Theory {hoursLabel(Number(m.theoryHours))}
                        <br />
                        Practical {hoursLabel(Number(m.practicalHours ?? 0))}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <button type="button" className="rounded p-1.5 text-muted hover:bg-surface hover:text-brand" aria-label={`Edit ${m.name}`} onClick={() => { setEditing(i); setDraft({ name: m.name, amount: m.hours, theory: m.theoryHours ?? '', practical: m.practicalHours ?? '', unit: 'hours' }); }}>
                      <Pencil className="size-4" />
                    </button>
                    <button type="button" className="rounded p-1.5 text-muted hover:bg-surface hover:text-brand" aria-label={`Delete ${m.name}`} onClick={() => set('modules', v.modules.filter((_, j) => j !== i))}>
                      <Trash2 className="size-4" />
                    </button>
                  </td>
                </tr>
              ))}
              <tr className="bg-surface/30">
                <td className="px-3 py-2 text-muted">{editing !== null ? editing + 1 : v.modules.length + 1}</td>
                <td className="px-3 py-2">
                  <label htmlFor="w-mod-name" className="sr-only">Module name</label>
                  <input id="w-mod-name" className="field-input h-9" placeholder="Module name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), saveModule())} />
                </td>
                <td className="px-3 py-2">
                  {hybrid ? (
                    <>
                      <label htmlFor="w-mod-theory" className="block text-xs text-muted">Theory</label>
                      <input id="w-mod-theory" type="number" min={0} step="any" inputMode="decimal" className="field-input h-9" placeholder={draft.unit === 'minutes' ? 'Min' : 'Hrs'} value={draft.theory} onChange={(e) => setDraft({ ...draft, theory: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), saveModule())} />
                      <label htmlFor="w-mod-practical" className="mt-1 block text-xs text-muted">Practical</label>
                      <input id="w-mod-practical" type="number" min={0} step="any" inputMode="decimal" className="field-input h-9" placeholder={draft.unit === 'minutes' ? 'Min' : 'Hrs'} value={draft.practical} onChange={(e) => setDraft({ ...draft, practical: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), saveModule())} />
                    </>
                  ) : (
                    <>
                      <label htmlFor="w-mod-hours" className="sr-only">Time</label>
                      <input id="w-mod-hours" type="number" min={0} step="any" inputMode="decimal" className="field-input h-9" placeholder={draft.unit === 'minutes' ? 'Min' : 'Hrs'} value={draft.amount} onChange={(e) => setDraft({ ...draft, amount: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), saveModule())} />
                    </>
                  )}
                  <label htmlFor="w-mod-unit" className="sr-only">Unit</label>
                  <select id="w-mod-unit" className="field-input mt-1 h-9 py-0 pr-7 pl-2 text-sm" value={draft.unit} onChange={(e) => setDraft({ ...draft, unit: e.target.value as 'hours' | 'minutes' })}>
                    <option value="hours">Hrs</option>
                    <option value="minutes">Mins</option>
                  </select>
                  {draftHours > 0 && (hybrid || draft.unit === 'minutes') && <span className="mt-1 block text-xs text-muted">{hybrid ? 'Total' : '='} {draftHours} h</span>}
                </td>
                <td className="px-3 py-2 text-right">
                  <button type="button" className="btn-quiet btn-sm" onClick={saveModule} disabled={!draftOk}>
                    {editing !== null ? <Check className="size-4" aria-hidden /> : <Plus className="size-4" aria-hidden />}
                    {editing !== null ? 'Save' : 'Add'}
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h3 className="mb-2 font-semibold">Skills covered</h3>
        {errorFor('skills') && <p className="field-error mb-2" role="alert">{errorFor('skills')}</p>}
        <div className="flex flex-wrap gap-2">
          {[...new Set([...SUGGESTED_SKILLS, ...v.skills])].map((s) => {
            const on = v.skills.includes(s);
            return (
              <button key={s} type="button" aria-pressed={on} onClick={() => toggleSkill(s)} className={`inline-flex min-h-8 items-center gap-1.5 rounded-full border px-3 py-1 text-left text-sm transition-colors ${on ? 'border-brand bg-brand text-white' : 'border-line bg-white hover:bg-surface'}`}>
                {on && <Check className="size-3.5" aria-hidden />}
                {s}
              </button>
            );
          })}
        </div>
        <div className="mt-3 flex max-w-sm gap-2">
          <label htmlFor="w-skill" className="sr-only">Add another skill</label>
          <input id="w-skill" className="field-input h-9" placeholder="Add another skill" value={skill} onChange={(e) => setSkill(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && skill.trim().length >= 2) { e.preventDefault(); set('skills', [...new Set([...v.skills, skill.trim()])]); setSkill(''); } }} />
          <button type="button" className="btn-secondary btn-sm h-9" disabled={skill.trim().length < 2} onClick={() => { set('skills', [...new Set([...v.skills, skill.trim()])]); setSkill(''); }}>Add</button>
        </div>
      </section>

      <Field label="Prerequisites" htmlFor="w-pre" error={errors.prerequisites}>
        <input id="w-pre" className="field-input" placeholder="For example, 10th pass" value={v.prerequisites} onChange={(e) => set('prerequisites', e.target.value)} />
      </Field>

      <section>
        <h3 className="mb-2 font-semibold">Learning outcomes</h3>
        {errorFor('learningOutcomes') && <p className="field-error mb-2" role="alert">{errorFor('learningOutcomes')}</p>}
        {v.learningOutcomes.length > 0 && (
          <ul className="mb-3 space-y-2">
            {v.learningOutcomes.map((o, i) => (
              <li key={i} className="flex items-start gap-2 rounded-lg bg-surface px-3 py-2 text-sm">
                <Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
                <span className="flex-1">{o}</span>
                <button type="button" className="text-muted hover:text-brand" aria-label="Remove outcome" onClick={() => set('learningOutcomes', v.learningOutcomes.filter((_, j) => j !== i))}><X className="size-4" /></button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex gap-2">
          <label htmlFor="w-out" className="sr-only">Add a learning outcome</label>
          <input id="w-out" className="field-input" placeholder="For example, Diagnose and fix common engine faults" value={outcome} onChange={(e) => setOutcome(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && outcome.trim().length >= 3) { e.preventDefault(); set('learningOutcomes', [...v.learningOutcomes, outcome.trim()]); setOutcome(''); } }} />
          <button type="button" className="btn-secondary" disabled={outcome.trim().length < 3} onClick={() => { set('learningOutcomes', [...v.learningOutcomes, outcome.trim()]); setOutcome(''); }}>
            <Plus className="size-4" aria-hidden /> Add
          </button>
        </div>
      </section>
    </div>
  );
}

function StepFee({ v, set, errors }: StepProps) {
  const fee = Number(v.feeRupees) || 0;
  const { gstRupees, totalRupees } = feeWithGst(fee, Number(v.gstPct));
  const b = v.batch;
  const setB = (k: keyof WizardValues['batch'], val: string) => set('batch', { ...b, [k]: val, ...(k === 'centreId' && { trainerId: '' }) });
  const [adding, setAdding] = useState(false);
  const centres = useQuery({ queryKey: ['centre-options'], queryFn: () => api.get<Page<{ id: string; name: string; city: string | null }>>(`/centres${qs({ status: 'active', pageSize: 100 })}`) });
  const trainers = useQuery({
    queryKey: ['trainer-options', b.centreId],
    enabled: !!b.centreId,
    queryFn: () => api.get<Page<{ id: string; name: string; centres: unknown[] }>>(`/trainers${qs({ centreId: b.centreId, includeIndependent: 'true', verificationStatus: 'verified', pageSize: 100 })}`),
  });
  const e = (k: string) => errors[`firstBatch.${k}`];

  return (
    <div className="space-y-7">
      <h2 className="text-lg font-bold">Fee & batch setup</h2>
      <section className="grid gap-5 md:grid-cols-3">
        <Field label="Course fee (₹)" htmlFor="w-fee" error={errors.feeRupees} hint="Enter 0 for a free course.">
          <input id="w-fee" type="number" min={0} className="field-input" placeholder="5000" value={v.feeRupees} onChange={(ev) => set('feeRupees', ev.target.value)} />
        </Field>
        <Field label="GST" htmlFor="w-gst" error={errors.gstPct}>
          <select id="w-gst" className="field-input" value={v.gstPct} onChange={(ev) => set('gstPct', ev.target.value)}>
            {GST_RATES.map((r) => <option key={r} value={r}>{r}%</option>)}
          </select>
        </Field>
        <div>
          <p className="field-label">Total fee (incl. GST)</p>
          <p className="flex h-11 items-center rounded-lg bg-surface px-3 text-[17px] font-bold">{rupees(totalRupees)}</p>
          <p className="mt-1.5 text-[13px] text-muted">GST {rupees(gstRupees)}</p>
        </div>
        <div className="md:col-span-3">
          <Field label="Certificate type" htmlFor="w-cert" error={errors.certificateType}>
            <select id="w-cert" className="field-input md:w-80" value={v.certificateType} onChange={(ev) => set('certificateType', ev.target.value)}>
              <option value="">Choose a certificate type</option>
              {CERTIFICATE_TYPES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </Field>
        </div>
        <div className="md:col-span-3">
          <StayFields
            available={v.stayAvailable}
            fee={v.stayFeeRupees}
            error={errors.stayFeeRupees}
            onChange={(x) => {
              set('stayAvailable', x.available);
              set('stayFeeRupees', x.fee);
            }}
          />
        </div>
      </section>

      <section className="rounded-xl border border-line p-4 sm:p-5">
        <h3 className="font-semibold">Create first batch</h3>
        <p className="mb-4 text-sm text-muted">This batch opens for enrolment as soon as AutoTalent Grid publishes the course.</p>
        {errors.firstBatch && <p className="field-error mb-3" role="alert">{errors.firstBatch}</p>}
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Batch name" htmlFor="w-b-name" error={e('name')}>
            <input id="w-b-name" className="field-input" placeholder="For example, 2W Service Peenya December 2026" value={b.name} onChange={(ev) => setB('name', ev.target.value)} />
          </Field>
          <Field label="Location (centre)" htmlFor="w-b-centre" error={e('centreId')} hint={centres.data && centres.data.items.length === 0 ? 'Your organisation has no centre yet. Choose “+ Add a new centre” to add one.' : undefined}>
            <select id="w-b-centre" className="field-input" value={b.centreId} onChange={(ev) => (ev.target.value === ADD_CENTRE ? setAdding(true) : setB('centreId', ev.target.value))}>
              <option value="">{centres.data && centres.data.items.length === 0 ? 'No centres yet' : 'Choose a centre'}</option>
              {centres.data?.items.map((c) => <option key={c.id} value={c.id}>{c.name}{c.city ? `, ${c.city}` : ''}</option>)}
              <option value={ADD_CENTRE}>+ Add a new centre</option>
            </select>
          </Field>
          <Field label="Start date" htmlFor="w-b-start" error={e('startDate')}>
            <input id="w-b-start" type="date" className="field-input" value={b.startDate} onChange={(ev) => setB('startDate', ev.target.value)} />
          </Field>
          <Field label="End date" htmlFor="w-b-end" error={e('endDate')}>
            <input id="w-b-end" type="date" className="field-input" value={b.endDate} onChange={(ev) => setB('endDate', ev.target.value)} />
          </Field>
          <Field label="Trainer" htmlFor="w-b-trainer" error={e('trainerId')} hint={b.centreId ? 'Verified trainers at this centre, and verified independent trainers.' : 'Choose a centre first.'}>
            <select id="w-b-trainer" className="field-input" value={b.trainerId} onChange={(ev) => setB('trainerId', ev.target.value)} disabled={!b.centreId}>
              <option value="">{b.centreId && trainers.data?.items.length === 0 ? 'No verified trainers at this centre' : 'Choose a trainer'}</option>
              {trainers.data?.items.map((t) => <option key={t.id} value={t.id}>{t.name}{t.centres.length === 0 ? ' (independent)' : ''}</option>)}
            </select>
          </Field>
          <Field label="Total seats" htmlFor="w-b-seats" error={e('capacity')}>
            <input id="w-b-seats" type="number" min={1} max={500} className="field-input" value={b.capacity} onChange={(ev) => setB('capacity', ev.target.value)} />
          </Field>
          <div className="md:col-span-2">
            <Field label="Class timings" htmlFor="w-b-time" error={e('classTimings')}>
              <input id="w-b-time" className="field-input" placeholder="For example, Mon–Sat, 10:00 AM – 1:00 PM" value={b.classTimings} onChange={(ev) => setB('classTimings', ev.target.value)} />
            </Field>
          </div>
        </div>
      </section>
      {adding && (
        <AddCentreModal
          onClose={() => setAdding(false)}
          onAdded={(newId) => {
            setAdding(false);
            setB('centreId', newId);
          }}
        />
      )}
    </div>
  );
}

// ====================================================================== screen 9: course management

export function PartnerCourseDetailPage() {
  const { id = '' } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const [tab, setTab] = useState<'batches' | 'details' | 'history'>('batches');
  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const q = useQuery({ queryKey: ['partner-course', id], queryFn: () => api.get<CourseDetail>(`/partner/courses/${id}`) });
  if (q.isLoading) return <Spinner />;
  if (q.isError) return <ErrorNote message={(q.error as Error).message} />;
  const c = q.data!;
  const published = c.approvalStatus === 'published';
  const rows: (CourseBatch & { planned?: boolean })[] = c.batches.length
    ? c.batches
    : c.firstBatch
      ? [{ id: 'planned', name: c.firstBatch.name, status: 'draft', startDate: c.firstBatch.startDate, endDate: c.firstBatch.endDate, capacity: c.firstBatch.capacity, enrolled: 0, classTimings: c.firstBatch.classTimings ?? null, centre: c.firstBatch.centreName ?? '', city: null, trainer: c.firstBatch.trainerName ?? '', planned: true }]
      : [];

  return (
    <div>
      <Link to="/partner/courses" className="inline-flex items-center gap-1 text-sm text-muted hover:text-brand">
        <ArrowLeft className="size-4" aria-hidden /> Courses
      </Link>

      {params.get('submitted') && c.approvalStatus === 'submitted' && (
        <div className="mt-4 flex gap-3 rounded-xl border border-success/30 bg-success-tint px-4 py-3 text-sm">
          <Check className="size-5 shrink-0 text-success" aria-hidden />
          <span><span className="font-semibold">Submitted for admin review.</span> AutoTalent Grid will check the course. You will get a notification when it is approved or if changes are needed.</span>
        </div>
      )}
      {c.approvalStatus === 'changes_requested' && (
        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-brand/30 bg-brand-tint px-4 py-3 text-sm">
          <AlertTriangle className="size-5 shrink-0 text-brand" aria-hidden />
          <span className="flex-1"><span className="font-semibold">AutoTalent Grid asked for changes:</span> {c.reviewNote}</span>
          <Link to={`/partner/courses/${c.id}/edit`} className="btn-primary btn-sm">Make changes</Link>
        </div>
      )}
      {c.approvalStatus === 'rejected' && c.reviewNote && (
        <div className="mt-4 rounded-xl border border-brand/30 bg-brand-tint px-4 py-3 text-sm"><span className="font-semibold">Not approved:</span> {c.reviewNote}</div>
      )}

      <div className="card mt-4 flex flex-col gap-5 px-5 py-5 sm:flex-row sm:items-center">
        <CourseThumb c={c} className="h-28 w-full sm:w-44" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-[24px] font-bold tracking-tight">{c.title}</h1>
            <ApprovalBadge status={c.approvalStatus} active={c.active} />
          </div>
          <p className="mt-1 text-sm text-muted">
            {COURSE_CATEGORY_LABEL[c.skillArea]} · {c.city ?? '—'} · {c.totalFeeRupees ? `${rupees(c.totalFeeRupees)} incl. GST` : 'Free'}
            {c.publishedAt && ` · published ${formatDate(c.publishedAt)}`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {c.editable && (
            <Link to={`/partner/courses/${c.id}/edit${c.approvalStatus === 'draft' ? '' : '?step=4'}`} className="btn-secondary">
              <Pencil className="size-4" aria-hidden /> {c.approvalStatus === 'draft' ? 'Continue editing' : 'Edit & resubmit'}
            </Link>
          )}
          {c.approvalStatus === 'draft' && !c.submittedAt && (
            <button type="button" className="btn-secondary" onClick={() => setConfirmDelete(true)}>
              <Trash2 className="size-4" aria-hidden /> Delete
            </button>
          )}
          {published && c.active && (
            <button type="button" className="btn-primary" onClick={() => setCreating(true)}>
              <Plus className="size-4" aria-hidden /> Create batch
            </button>
          )}
        </div>
      </div>

      <div className="mt-5 flex gap-1 border-b border-line" role="tablist">
        {([['batches', 'Batches'], ['details', 'Course details'], ['history', 'History']] as const).map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`-mb-px border-b-2 px-4 py-2.5 text-sm font-semibold ${tab === k ? 'border-brand text-brand' : 'border-transparent text-muted hover:text-ink'}`}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'batches' && (
        <div className="card mt-4 overflow-hidden">
          {rows.length === 0 ? (
            <EmptyState title="No batches yet" body={published ? 'Create a batch so learners can enrol.' : 'Batches can be created once the course is published.'} />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead className="bg-surface/70 text-left text-xs uppercase tracking-wide text-muted">
                  <tr>
                    <th className="px-5 py-2.5">Batch name</th>
                    <th className="px-3 py-2.5">Start date</th>
                    <th className="px-3 py-2.5">End date</th>
                    <th className="px-3 py-2.5">Seats</th>
                    <th className="px-3 py-2.5">Enrolled</th>
                    <th className="px-3 py-2.5">Status</th>
                    <th className="px-5 py-2.5 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {rows.map((b) => (
                    <tr key={b.id}>
                      <td className="px-5 py-3">
                        <span className="block font-medium">{b.name}</span>
                        <span className="block text-xs text-muted">{[b.centre, b.trainer, b.classTimings].filter(Boolean).join(' · ')}</span>
                      </td>
                      <td className="px-3 py-3">{fmtDay(b.startDate)}</td>
                      <td className="px-3 py-3">{fmtDay(b.endDate)}</td>
                      <td className="px-3 py-3">{b.capacity}</td>
                      <td className="px-3 py-3">{b.enrolled}</td>
                      <td className="px-3 py-3"><BatchBadge status={b.status} /></td>
                      <td className="px-5 py-3 text-right">
                        {b.planned ? <span className="text-xs text-muted">Opens on publish</span> : <Link to={`/partner/batches/${b.id}`} className="btn-secondary btn-sm">View</Link>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
      {tab === 'details' && <div className="card mt-4 px-5 py-6 sm:px-7"><CourseSummary c={c} /></div>}
      {tab === 'history' && <div className="card mt-4 px-5 py-6 sm:px-7"><HistoryList items={c.history} /></div>}

      {creating && (
        <CreateBatchModal
          base="/partner/batches"
          presetCourseId={c.id}
          onClose={() => setCreating(false)}
          onCreated={async () => {
            setCreating(false);
            await qc.invalidateQueries({ queryKey: ['partner-course', id] });
          }}
        />
      )}
      <Modal
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="Delete this draft?"
        footer={
          <>
            <button className="btn-secondary" onClick={() => setConfirmDelete(false)}>Keep it</button>
            <button
              className="btn-primary"
              onClick={async () => {
                await api.del(`/partner/courses/${c.id}`);
                await qc.invalidateQueries({ queryKey: ['partner-courses'] });
                toast('success', 'Draft deleted');
                navigate('/partner/courses');
              }}
            >
              Delete draft
            </button>
          </>
        }
      >
        <p className="text-sm">“{c.title}” will be removed. This cannot be undone.</p>
      </Modal>
    </div>
  );
}
