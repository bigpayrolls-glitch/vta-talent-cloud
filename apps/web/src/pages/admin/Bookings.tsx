import { useQuery, useQueryClient } from '@tanstack/react-query';
import { BOOKING_STATUS_LABEL, TRACK_LABEL, TRACK_STEP_LABEL, type BookingStatus, type Track, type TrackStep } from '@vta/shared';
import { BedDouble } from 'lucide-react';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useToast } from '../../components/toast';
import { EmptyState, ErrorNote, Modal, PageHeader, Spinner, formatDate, formatPhone } from '../../components/ui';
import { api, ApiError } from '../../lib/api';

interface Booking {
  id: string;
  status: BookingStatus;
  bookedAt: string;
  assignedAt: string | null;
  needsStay: boolean;
  amountRupees: number;
  test: boolean;
  receiptNumber: string;
  course: { id: string; title: string; track: Track | null; step: number | null };
  learner: { id: string; name: string; phone: string | null; code: string; city: string | null };
  batch: { id: string; name: string } | null;
}

interface OpenBatch {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  centre: string;
  city: string | null;
  provider: string;
  seatsLeft: number;
}

const TABS: BookingStatus[] = ['awaiting_batch', 'placed', 'cancelled'];

/**
 * Career journey courses: learners enrol and pay for the course; AutoTalent Grid places each one in a batch of
 * that course at a training partner's centre.
 */
export function BookingsPage() {
  const [params, setParams] = useSearchParams();
  const status = (TABS as string[]).includes(params.get('status') ?? '') ? (params.get('status') as BookingStatus) : 'awaiting_batch';
  const q = useQuery({ queryKey: ['admin', 'bookings', status], queryFn: () => api.get<{ items: Booking[] }>(`/admin/bookings?status=${status}`) });
  const [assigning, setAssigning] = useState<Booking | null>(null);

  return (
    <div>
      <PageHeader
        title="Course enrolments"
        description="Learners who enrolled and paid for an AutoTalent Grid career journey course. Assign each one to a batch of that course at a training partner's centre."
      />
      <div className="mb-4 flex flex-wrap gap-1 border-b border-line" role="tablist">
        {TABS.map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={status === t}
            onClick={() => setParams(t === 'awaiting_batch' ? {} : { status: t })}
            className={`-mb-px border-b-2 px-4 py-2.5 text-sm font-semibold ${status === t ? 'border-brand text-brand' : 'border-transparent text-muted hover:text-ink'}`}
          >
            {t === 'awaiting_batch' ? 'Waiting for a batch' : BOOKING_STATUS_LABEL[t]}
          </button>
        ))}
      </div>
      <div className="card overflow-hidden">
        {q.isLoading ? (
          <Spinner />
        ) : q.isError ? (
          <div className="p-4">
            <ErrorNote message={(q.error as Error).message} />
          </div>
        ) : !q.data!.items.length ? (
          <EmptyState title={status === 'awaiting_batch' ? 'No one is waiting for a batch' : 'Nothing here'} body="When a learner enrols in a career journey course, they appear here." />
        ) : (
          <ul className="divide-y divide-line">
            {q.data!.items.map((b) => (
              <li key={b.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <Link to={`/admin/candidates/${b.learner.id}`} className="font-semibold hover:text-brand">
                    {b.learner.name}
                  </Link>
                  <p className="text-[13px] text-muted">
                    {b.learner.code}
                    {b.learner.phone ? `, ${formatPhone(b.learner.phone)}` : ''}
                    {b.learner.city ? `, ${b.learner.city}` : ''}
                  </p>
                  <p className="mt-1 text-sm">
                    {b.course.title}
                    {b.course.track && b.course.step && (
                      <span className="ml-2 text-[13px] text-muted">
                        ({TRACK_LABEL[b.course.track]}, step {b.course.step}: {TRACK_STEP_LABEL[b.course.step as TrackStep]})
                      </span>
                    )}
                  </p>
                  <p className="text-[13px] text-muted">
                    Enrolled {formatDate(b.bookedAt)}. Paid ₹{b.amountRupees.toLocaleString('en-IN')}
                    {b.test ? ' (test)' : ''}. Receipt {b.receiptNumber}.
                    {b.batch && (
                      <>
                        {' '}
                        Batch:{' '}
                        <Link to={`/admin/batches/${b.batch.id}`} className="font-medium text-brand underline">
                          {b.batch.name}
                        </Link>
                      </>
                    )}
                  </p>
                  {b.needsStay && (
                    <p className="mt-1 inline-flex items-center gap-1 rounded-full bg-warning-tint px-2 py-0.5 text-xs font-semibold text-warning">
                      <BedDouble className="size-3.5" aria-hidden />
                      Needs accommodation with food
                    </p>
                  )}
                </div>
                {b.status === 'awaiting_batch' && (
                  <button className="btn-primary" onClick={() => setAssigning(b)}>
                    Assign batch
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
      {assigning && <AssignModal booking={assigning} onClose={() => setAssigning(null)} />}
    </div>
  );
}

function AssignModal({ booking, onClose }: { booking: Booking; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const batches = useQuery({ queryKey: ['admin', 'bookings', booking.id, 'batches'], queryFn: () => api.get<{ items: OpenBatch[] }>(`/admin/bookings/${booking.id}/batches`) });
  const [batchId, setBatchId] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const assign = async () => {
    if (!batchId) return setError('Choose a batch');
    setSaving(true);
    setError('');
    try {
      await api.post(`/admin/bookings/${booking.id}/assign`, { batchId });
      await qc.invalidateQueries({ queryKey: ['admin', 'bookings'] });
      toast('success', `${booking.learner.name} assigned to the batch`);
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not assign the batch');
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title="Assign batch"
      footer={
        <>
          <button className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary" onClick={() => void assign()} disabled={saving || !batches.data?.items.length}>
            {saving ? 'Assigning…' : 'Assign'}
          </button>
        </>
      }
    >
      <p className="mb-3 text-sm">
        <span className="font-semibold">{booking.learner.name}</span> for {booking.course.title}.{booking.needsStay ? ' Needs accommodation with food.' : ''}
      </p>
      {error && (
        <div className="mb-3">
          <ErrorNote message={error} />
        </div>
      )}
      {batches.isLoading ? (
        <Spinner />
      ) : batches.isError ? (
        <ErrorNote message={(batches.error as Error).message} />
      ) : !batches.data!.items.length ? (
        <p className="rounded-lg bg-surface px-4 py-3 text-sm">
          There is no open batch of this course yet. Create one in{' '}
          <Link to="/admin/batches" className="font-semibold text-brand underline">
            Batches
          </Link>{' '}
          at the training partner&apos;s centre, then come back.
        </p>
      ) : (
        <fieldset>
          <legend className="sr-only">Batch</legend>
          <ul className="space-y-2">
            {batches.data!.items.map((b) => (
              <li key={b.id}>
                <label className={`flex cursor-pointer items-start gap-3 rounded-lg border px-4 py-3 text-sm ${batchId === b.id ? 'border-brand bg-brand-tint' : 'border-line hover:bg-surface'} ${b.seatsLeft ? '' : 'opacity-60'}`}>
                  <input type="radio" name="batch" className="mt-0.5 size-4 accent-[var(--color-brand)]" disabled={!b.seatsLeft} checked={batchId === b.id} onChange={() => setBatchId(b.id)} />
                  <span>
                    <span className="block font-semibold">{b.name}</span>
                    <span className="block text-muted">
                      {b.provider}, {b.centre}
                      {b.city ? `, ${b.city}` : ''}
                    </span>
                    <span className="block text-muted">
                      {formatDate(b.startDate)} to {formatDate(b.endDate)}. {b.seatsLeft ? `${b.seatsLeft} seats left` : 'Full'}
                    </span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </fieldset>
      )}
    </Modal>
  );
}
