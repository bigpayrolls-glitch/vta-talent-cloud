import { useQuery, useQueryClient } from '@tanstack/react-query';
import { GST_RATES, TRACK_LABEL, TRACKS, TRACK_STEP_LABEL, type Page, type Track, type TrackStep } from '@vta/shared';
import { ArrowLeft, BedDouble } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { useToast } from '../../components/toast';
import { ErrorNote, PageHeader, Spinner, StatusBadge } from '../../components/ui';
import { api, ApiError } from '../../lib/api';

interface FeeCourse {
  id: string;
  code: string | null;
  title: string;
  status: 'active' | 'inactive';
  feeRupees: number;
  gstPct: number;
  stayAvailable: boolean;
  stayFeeRupees: number | null;
  track: Track | null;
  trackStep: number | null;
  imageUrl: string | null;
}

const rupees = (n: number) => `₹${n.toLocaleString('en-IN')}`;

/**
 * Admin > Courses > Fees and accommodation (29 Oct 2026): the AutoTalent Grid career courses in one table, to set
 * each course fee, GST, the accommodation-with-food charge, and switch the course on for learners.
 */
export function CourseFeesPage() {
  const q = useQuery({ queryKey: ['courses', 'fees'], queryFn: () => api.get<Page<FeeCourse>>('/courses?pageSize=100') });
  const courses = (q.data?.items ?? []).filter((c) => c.track).sort((a, b) => TRACKS.indexOf(a.track!) - TRACKS.indexOf(b.track!) || (a.trackStep ?? 0) - (b.trackStep ?? 0));
  return (
    <div>
      <Link to="/admin/courses" className="inline-flex items-center gap-1.5 text-sm font-medium text-muted hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden />
        Courses
      </Link>
      <PageHeader
        title="Fees and accommodation"
        description="Set the fee of each AutoTalent Grid career course and the charge for accommodation with food, then switch it on. Learners see a course only when it is on. Changes apply to new enrolments."
      />
      {q.isLoading ? (
        <Spinner />
      ) : q.isError ? (
        <ErrorNote message={(q.error as Error).message} />
      ) : (
        <div className="space-y-6">
          {TRACKS.map((t) => (
            <section key={t} className="card overflow-x-auto" aria-labelledby={`fees-${t}`}>
              <h2 id={`fees-${t}`} className="px-4 pt-4 text-lg font-bold">
                {TRACK_LABEL[t]}
              </h2>
              <table className="mt-2 w-full min-w-[900px] text-sm">
                <thead className="bg-surface text-left text-[13px] text-muted">
                  <tr>
                    <th className="px-4 py-2 font-semibold">Course</th>
                    <th className="px-2 py-2 font-semibold">Course fee (₹)</th>
                    <th className="px-2 py-2 font-semibold">GST</th>
                    <th className="px-2 py-2 font-semibold">Accommodation with food</th>
                    <th className="px-2 py-2 font-semibold">Charge (₹, whole course)</th>
                    <th className="px-2 py-2 font-semibold">Learner pays</th>
                    <th className="px-2 py-2 font-semibold">Status</th>
                    <th className="px-4 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {courses
                    .filter((c) => c.track === t)
                    .map((c) => (
                      <FeeRow key={c.id} c={c} />
                    ))}
                </tbody>
              </table>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function FeeRow({ c }: { c: FeeCourse }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [fee, setFee] = useState(c.feeRupees ? String(c.feeRupees) : '');
  const [gst, setGst] = useState(String(c.gstPct));
  const [stay, setStay] = useState(c.stayAvailable);
  const [stayFee, setStayFee] = useState(c.stayFeeRupees != null ? String(c.stayFeeRupees) : '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const feeN = Number(fee) || 0;
  const gstN = Math.round((feeN * Number(gst)) / 100);
  const changed = feeN !== c.feeRupees || Number(gst) !== c.gstPct || stay !== c.stayAvailable || (stay && (stayFee === '' ? null : Number(stayFee)) !== c.stayFeeRupees);

  const run = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true);
    setError('');
    try {
      await fn();
      await qc.invalidateQueries({ queryKey: ['courses'] });
      toast('success', done);
    } catch (e) {
      setError(e instanceof ApiError ? Object.values(e.fields)[0] ?? e.message : 'Could not save');
    } finally {
      setBusy(false);
    }
  };
  const save = () => run(() => api.patch(`/admin/courses/${c.id}`, { feeRupees: fee || '0', gstPct: gst, stayAvailable: stay, stayFeeRupees: stay && stayFee !== '' ? stayFee : null }), `${c.title}: saved`);
  const toggle = () =>
    run(async () => {
      if (c.status === 'inactive' && changed) await api.patch(`/admin/courses/${c.id}`, { feeRupees: fee || '0', gstPct: gst, stayAvailable: stay, stayFeeRupees: stay && stayFee !== '' ? stayFee : null });
      await api.post(`/admin/courses/${c.id}/${c.status === 'active' ? 'deactivate' : 'activate'}`);
    }, c.status === 'active' ? `${c.title}: switched off` : `${c.title}: now shown to learners`);

  const label = `${c.title}`;
  return (
    <tr className="align-top">
      <td className="px-4 py-3">
        <div className="flex items-center gap-3">
          {c.imageUrl ? <img src={c.imageUrl} alt="" className="h-10 w-16 shrink-0 rounded object-cover" /> : <span className="h-10 w-16 shrink-0 rounded bg-surface" />}
          <div>
            <Link to={`/admin/courses/${c.id}`} className="font-semibold hover:text-brand">
              {c.title}
            </Link>
            <p className="text-xs text-muted">
              Step {c.trackStep}: {TRACK_STEP_LABEL[c.trackStep as TrackStep]}
              {c.code ? `, ${c.code}` : ''}
            </p>
            {error && (
              <p className="field-error" role="alert">
                {error}
              </p>
            )}
          </div>
        </div>
      </td>
      <td className="px-2 py-3">
        <input type="number" min={0} step={1} inputMode="numeric" aria-label={`Course fee for ${label}`} className="field-input h-10 w-28" placeholder="0" value={fee} onChange={(e) => setFee(e.target.value)} />
      </td>
      <td className="px-2 py-3">
        <select aria-label={`GST for ${label}`} className="field-input h-10 w-20" value={gst} onChange={(e) => setGst(e.target.value)}>
          {GST_RATES.map((r) => (
            <option key={r} value={r}>
              {r}%
            </option>
          ))}
        </select>
      </td>
      <td className="px-2 py-3">
        <label className="flex h-10 items-center gap-2">
          <input type="checkbox" className="size-4 accent-[var(--color-brand)]" checked={stay} onChange={(e) => setStay(e.target.checked)} aria-label={`Accommodation with food for ${label}`} />
          <BedDouble className="size-4 text-muted" aria-hidden />
          {stay ? 'Offered' : 'Not offered'}
        </label>
      </td>
      <td className="px-2 py-3">
        <input
          type="number"
          min={0}
          step={1}
          inputMode="numeric"
          aria-label={`Accommodation with food charge for ${label}`}
          className="field-input h-10 w-28"
          placeholder={stay ? 'To confirm' : '—'}
          disabled={!stay}
          value={stay ? stayFee : ''}
          onChange={(e) => setStayFee(e.target.value)}
        />
      </td>
      <td className="px-2 py-3 text-[13px]">
        <span className="font-semibold">{rupees(feeN + gstN)}</span>
        {gstN > 0 && <span className="block text-muted">incl. {rupees(gstN)} GST</span>}
        {stay && <span className="block text-muted">+ {stayFee ? rupees(Number(stayFee)) : 'charge to confirm'} if they need a stay</span>}
      </td>
      <td className="px-2 py-3">
        <StatusBadge status={c.status} label={c.status === 'active' ? 'On' : 'Off'} />
      </td>
      <td className="px-4 py-3">
        <div className="flex flex-col gap-1.5">
          <button className="btn-secondary btn-sm" disabled={busy || !changed} onClick={() => void save()}>
            Save
          </button>
          <button className={c.status === 'active' ? 'btn-secondary btn-sm' : 'btn-primary btn-sm'} disabled={busy || (c.status === 'inactive' && !feeN)} onClick={() => void toggle()} title={c.status === 'inactive' && !feeN ? 'Enter the course fee first' : undefined}>
            {c.status === 'active' ? 'Switch off' : 'Switch on'}
          </button>
        </div>
      </td>
    </tr>
  );
}
