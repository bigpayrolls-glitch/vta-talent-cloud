import { COURSE_APPROVAL_LABEL, COURSE_CATEGORY_LABEL, COURSE_LEVEL_LABEL, COURSE_TYPE_LABEL, DELIVERY_MODE_LABEL, hoursLabel, splitLabel, type PartnerCourse } from '@vta/shared';
import { BatteryCharging, Bike, Car, Clock, GraduationCap, MapPin, MonitorPlay, Truck, Wrench } from 'lucide-react';
import { durationText } from '../../components/form';
import { StatusBadge } from '../../components/ui';

/** Shared pieces for the partner course screens and AutoTalent Grid's review screen. */

export const rupees = (n: number) => `₹${n.toLocaleString('en-IN')}`;

const AREA_ICON = { '2W': Bike, '4W': Car, EV: BatteryCharging, CV: Truck, other: Wrench } as const;

/** The course picture, or a tinted placeholder with the category icon. */
export function CourseThumb({ c, className = 'size-14' }: { c: Pick<PartnerCourse, 'imageUrl' | 'skillArea' | 'title'>; className?: string }) {
  if (c.imageUrl) return <img src={c.imageUrl} alt="" className={`${className} shrink-0 rounded-xl object-cover`} />;
  const Icon = AREA_ICON[c.skillArea] ?? Wrench;
  return (
    <span className={`${className} grid shrink-0 place-items-center rounded-xl bg-gradient-to-br from-brand-tint to-brand-tint-strong text-brand`} aria-hidden>
      <Icon className="size-1/2" />
    </span>
  );
}

export function ApprovalBadge({ status, active = true }: { status: PartnerCourse['approvalStatus']; active?: boolean }) {
  if (status === 'published' && !active) return <StatusBadge status="inactive" label="Hidden from learners" />;
  return <StatusBadge status={status} label={COURSE_APPROVAL_LABEL[status]} />;
}

/** planned → Upcoming, active → Ongoing, as in the wireframe. */
export function BatchBadge({ status }: { status: string }) {
  if (status === 'planned') return <StatusBadge status="upcoming" label="Upcoming" />;
  if (status === 'active') return <StatusBadge status="ongoing" label="Ongoing" />;
  if (status === 'draft') return <StatusBadge status="draft" label="Draft" />;
  return <StatusBadge status={status} />;
}

/** One-line facts: category, type, level, mode, duration. */
export function courseFacts(c: PartnerCourse) {
  return [
    COURSE_CATEGORY_LABEL[c.skillArea],
    c.courseType && COURSE_TYPE_LABEL[c.courseType],
    COURSE_LEVEL_LABEL[c.level],
    DELIVERY_MODE_LABEL[c.deliveryMode],
    durationText(c.durationValue, c.durationUnit),
  ].filter(Boolean) as string[];
}

/** The read-only course summary used by "Review & submit" and by AutoTalent Grid's review. */
export function CourseSummary({ c, section = 'all' }: { c: PartnerCourse; section?: 'all' | 'details' | 'content' | 'fee' }) {
  const show = (s: 'details' | 'content' | 'fee') => section === 'all' || section === s;
  return (
    <div className="space-y-6">
      {show('details') && (
        <section>
          {section === 'all' && <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">Basic details</h3>}
          <div className="flex flex-col gap-5 sm:flex-row">
            <CourseThumb c={c} className="h-36 w-full sm:w-56" />
            <div className="min-w-0 flex-1">
              <p className="text-xl font-bold">{c.title}</p>
              <ul className="mt-2 flex flex-wrap gap-2">
                {courseFacts(c).map((f) => (
                  <li key={f} className="rounded-full bg-surface px-2.5 py-0.5 text-xs font-medium">{f}</li>
                ))}
              </ul>
              <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
                {c.city && <span className="inline-flex items-center gap-1"><MapPin className="size-4" aria-hidden />{c.city}</span>}
                {c.trainingHours && <span className="inline-flex items-center gap-1"><Clock className="size-4" aria-hidden />{c.trainingHours} hours</span>}
                <span className="inline-flex items-center gap-1"><MonitorPlay className="size-4" aria-hidden />{DELIVERY_MODE_LABEL[c.deliveryMode]}</span>
              </p>
              {c.description && <p className="mt-3 whitespace-pre-line text-[15px] leading-relaxed">{c.description}</p>}
            </div>
          </div>
        </section>
      )}

      {show('content') && (
        <section className="grid gap-6 md:grid-cols-2">
          <div>
            <h3 className="mb-2 font-semibold">Course modules</h3>
            {c.modules.length === 0 ? (
              <p className="text-sm text-muted">No modules yet.</p>
            ) : (
              <table className="w-full text-sm">
                <tbody className="divide-y divide-line">
                  {c.modules.map((m, i) => (
                    <tr key={i}>
                      <td className="py-2 pr-2 text-muted">{i + 1}.</td>
                      <td className="py-2">{m.name}</td>
                      <td className="py-2 text-right text-muted">
                        {hoursLabel(m.hours)}
                        {splitLabel(m) && <span className="block text-xs">{splitLabel(m)}</span>}
                      </td>
                    </tr>
                  ))}
                  <tr className="font-semibold">
                    <td />
                    <td className="py-2">Total</td>
                    <td className="py-2 text-right">
                      {hoursLabel(c.modules.reduce((n, m) => n + m.hours, 0))}
                      {c.modules.some((m) => splitLabel(m)) && (
                        <span className="block text-xs font-normal text-muted">
                          {splitLabel({ theoryHours: c.modules.reduce((n, m) => n + (m.theoryHours ?? 0), 0), practicalHours: c.modules.reduce((n, m) => n + (m.practicalHours ?? 0), 0) })}
                        </span>
                      )}
                    </td>
                  </tr>
                </tbody>
              </table>
            )}
          </div>
          <div className="space-y-5">
            <div>
              <h3 className="mb-2 font-semibold">Skills covered</h3>
              {c.skills.length ? (
                <ul className="flex flex-wrap gap-2">
                  {c.skills.map((s) => <li key={s} className="rounded-full bg-brand-tint px-3 py-1 text-xs font-semibold text-brand">{s}</li>)}
                </ul>
              ) : <p className="text-sm text-muted">None chosen yet.</p>}
            </div>
            <div>
              <h3 className="mb-1 font-semibold">Prerequisites</h3>
              <p className="text-sm">{c.prerequisites || <span className="text-muted">None</span>}</p>
            </div>
            <div>
              <h3 className="mb-1 font-semibold">Learning outcomes</h3>
              {c.learningOutcomes.length ? (
                <ul className="list-disc space-y-1 pl-5 text-sm">{c.learningOutcomes.map((o, i) => <li key={i}>{o}</li>)}</ul>
              ) : <p className="text-sm text-muted">None yet.</p>}
            </div>
          </div>
        </section>
      )}

      {show('fee') && (
        <section className="grid gap-6 md:grid-cols-2">
          <div>
            <h3 className="mb-2 font-semibold">Fee</h3>
            <dl className="divide-y divide-line text-sm">
              <div className="flex justify-between py-2"><dt className="text-muted">Course fee</dt><dd>{rupees(c.feeRupees)}</dd></div>
              <div className="flex justify-between py-2"><dt className="text-muted">GST ({c.gstPct}%)</dt><dd>{rupees(c.totalFeeRupees - c.feeRupees)}</dd></div>
              <div className="flex justify-between py-2 font-semibold"><dt>Total fee (incl. GST)</dt><dd>{rupees(c.totalFeeRupees)}</dd></div>
              <div className="flex justify-between py-2"><dt className="text-muted">Certificate</dt><dd className="inline-flex items-center gap-1">{c.certificateType ? <><GraduationCap className="size-4 text-brand" aria-hidden />{c.certificateType}</> : '—'}</dd></div>
            </dl>
          </div>
          <div>
            <h3 className="mb-2 font-semibold">First batch</h3>
            {c.firstBatch ? (
              <dl className="divide-y divide-line text-sm">
                <div className="flex justify-between gap-4 py-2"><dt className="text-muted">Batch</dt><dd className="text-right">{c.firstBatch.name}</dd></div>
                <div className="flex justify-between gap-4 py-2"><dt className="text-muted">Centre</dt><dd className="text-right">{c.firstBatch.centreName ?? '—'}</dd></div>
                <div className="flex justify-between gap-4 py-2"><dt className="text-muted">Dates</dt><dd className="text-right">{fmtDay(c.firstBatch.startDate)} – {fmtDay(c.firstBatch.endDate)}</dd></div>
                <div className="flex justify-between gap-4 py-2"><dt className="text-muted">Trainer</dt><dd className="text-right">{c.firstBatch.trainerName ?? '—'}</dd></div>
                <div className="flex justify-between gap-4 py-2"><dt className="text-muted">Seats</dt><dd className="text-right">{c.firstBatch.capacity}</dd></div>
                <div className="flex justify-between gap-4 py-2"><dt className="text-muted">Class timings</dt><dd className="text-right">{c.firstBatch.classTimings || '—'}</dd></div>
              </dl>
            ) : <p className="text-sm text-muted">Not planned yet.</p>}
          </div>
        </section>
      )}
    </div>
  );
}

export const fmtDay = (d: string) => new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(`${d}T00:00:00`));

export const HISTORY_LABEL: Record<string, string> = {
  created: 'Created as a draft',
  submitted: 'Submitted for review',
  changes_requested: 'Changes requested',
  rejected: 'Rejected',
  published: 'Approved and published',
  unpublished: 'Hidden from learners',
  republished: 'Shown to learners again',
};

export function HistoryList({ items }: { items: { action: string; note: string | null; actor: string | null; at: string }[] }) {
  return (
    <ol className="relative ml-2 space-y-5 border-l border-line pl-6">
      {items.map((h, i) => (
        <li key={i} className="relative">
          <span className={`absolute -left-[31px] top-1 size-3 rounded-full ring-4 ring-white ${h.action === 'published' ? 'bg-success' : h.action === 'rejected' || h.action === 'changes_requested' ? 'bg-brand' : 'bg-muted'}`} aria-hidden />
          <p className="font-medium">{HISTORY_LABEL[h.action] ?? h.action}</p>
          <p className="text-sm text-muted">{[h.actor, new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(h.at))].filter(Boolean).join(' · ')}</p>
          {h.note && <p className="mt-1 rounded-lg bg-surface px-3 py-2 text-sm">{h.note}</p>}
        </li>
      ))}
    </ol>
  );
}
