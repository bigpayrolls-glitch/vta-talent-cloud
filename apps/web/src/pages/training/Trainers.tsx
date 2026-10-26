import { useQuery, useQueryClient } from '@tanstack/react-query';
import { reasonSchema, trainerCreateSchema, type Page } from '@vta/shared';
import { ArrowLeft, Plus } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { dateRange, SearchBox, Select, SkillAreaPicker, SkillTags } from '../../components/form';
import { useToast } from '../../components/toast';
import { EmptyState, ErrorNote, Field, formatPhone, Modal, PageHeader, Pagination, Spinner, StatusBadge } from '../../components/ui';
import { api, qs } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useForm } from '../../lib/useForm';
import { ChangePhoneButton } from '../admin/ChangePhone';
import { useListParams } from '../../lib/useListParams';

interface TrainerCentre {
  assignmentId: string;
  id: string;
  name: string;
  city: string | null;
  organisationName: string | null;
}
interface TrainerRow {
  id: string;
  name: string;
  phone: string | null;
  userStatus: string;
  specialisations: string[];
  verificationStatus: string;
  verificationReason: string | null;
  openBatches: number;
  centres: TrainerCentre[];
}
interface TrainerDetail extends Omit<TrainerRow, 'openBatches'> {
  email: string | null;
  batches: { id: string; name: string; status: string; startDate: string; endDate: string; courseTitle: string }[];
}
interface CentreOption {
  id: string;
  name: string;
  city: string | null;
  organisationName: string | null;
}

const centreLabel = (c: { name: string; city: string | null; organisationName: string | null }) =>
  `${c.name}${c.city ? `, ${c.city}` : ''} (${c.organisationName ?? 'VTA'})`;

function useCentres() {
  return useQuery({ queryKey: ['centre-options'], queryFn: () => api.get<Page<CentreOption>>(`/centres${qs({ status: 'active', pageSize: 100 })}`) });
}

export function TrainersPage() {
  const { can } = useAuth();
  const { values, page, set, setPage } = useListParams(['q', 'verificationStatus', 'centreId'] as const);
  const [adding, setAdding] = useState(false);
  const centres = useCentres();
  const q = useQuery({
    queryKey: ['trainers', values, page],
    queryFn: () => api.get<Page<TrainerRow>>(`/trainers${qs({ ...values, page, pageSize: 20 })}`),
    placeholderData: (p) => p,
  });

  return (
    <div>
      <PageHeader
        title="Trainers"
        description="Trainers, the centres they teach at, and whether they are verified to run batches."
        actions={
          can('trainer.manage') && (
            <button className="btn-primary" onClick={() => setAdding(true)}>
              <Plus className="size-4" aria-hidden />
              Add trainer
            </button>
          )
        }
      />
      <div className="mb-4 flex flex-col gap-3 md:flex-row">
        <SearchBox initial={values.q} onSearch={(v) => set('q', v)} placeholder="Search by name or mobile" label="Search trainers" />
        <div className="flex gap-3">
          <Select id="t-centre" label="Centre" className="md:w-56" value={values.centreId} onChange={(v) => set('centreId', v)} options={[{ value: '', label: 'All centres' }, ...(centres.data?.items ?? []).map((c) => ({ value: c.id, label: c.name }))]} />
          <Select id="t-status" label="Verification" className="md:w-44" value={values.verificationStatus} onChange={(v) => set('verificationStatus', v)} options={[{ value: '', label: 'Any status' }, { value: 'pending', label: 'Pending' }, { value: 'verified', label: 'Verified' }, { value: 'more_info_needed', label: 'More info needed' }, { value: 'rejected', label: 'Rejected' }]} />
        </div>
      </div>
      <div className="card overflow-hidden">
        {q.isLoading ? (
          <Spinner />
        ) : q.isError ? (
          <div className="p-4"><ErrorNote message={(q.error as Error).message} /></div>
        ) : q.data!.items.length === 0 ? (
          <EmptyState title="No trainers found" />
        ) : (
          <>
            <ul className="divide-y divide-line">
              {q.data!.items.map((t) => (
                <li key={t.id}>
                  <Link to={`/admin/trainers/${t.id}`} className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-5 py-4 hover:bg-surface/60">
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold">{t.name}</span>
                        <SkillTags areas={t.specialisations} />
                      </span>
                      <span className="mt-0.5 block text-sm text-muted">{t.centres.map((c) => c.name).join(', ')}</span>
                    </span>
                    <span className="text-sm text-muted">{t.openBatches} open {t.openBatches === 1 ? 'batch' : 'batches'}</span>
                    <StatusBadge status={t.verificationStatus} />
                  </Link>
                </li>
              ))}
            </ul>
            <Pagination page={q.data!.page} pageSize={q.data!.pageSize} total={q.data!.total} onPage={setPage} />
          </>
        )}
      </div>
      {adding && <AddTrainerModal onClose={() => setAdding(false)} />}
    </div>
  );
}

function AddTrainerModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const centres = useCentres();
  const f = useForm(trainerCreateSchema);
  const [v, setV] = useState({ name: '', phone: '', email: '', centreId: '' });
  const [specs, setSpecs] = useState<string[]>([]);
  return (
    <Modal
      open
      onClose={onClose}
      title="Add trainer"
      footer={
        <>
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" type="submit" form="trainer-form" disabled={f.submitting}>Add trainer</button>
        </>
      }
    >
      <form
        id="trainer-form"
        noValidate
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void f.submit({ ...v, email: v.email || undefined, specialisations: specs }, async (data) => {
            await api.post('/admin/trainers', data);
            await qc.invalidateQueries({ queryKey: ['trainers'] });
            toast('success', 'Trainer added. They can sign in with their mobile number. Verify them before assigning batches.');
            onClose();
          });
        }}
      >
        {f.formError && <ErrorNote message={f.formError} />}
        <Field label="Full name" htmlFor="tr-name" error={f.errors.name}>
          <input id="tr-name" autoFocus className="field-input" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} />
        </Field>
        <Field label="Mobile number" htmlFor="tr-phone" error={f.errors.phone} hint="Trainers sign in with a code sent to this number.">
          <input id="tr-phone" type="tel" inputMode="numeric" className="field-input" placeholder="98765 43210" value={v.phone} onChange={(e) => setV({ ...v, phone: e.target.value })} />
        </Field>
        <Field label="Email (optional)" htmlFor="tr-email" error={f.errors.email}>
          <input id="tr-email" type="email" className="field-input" value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} />
        </Field>
        <Field label="Centre" htmlFor="tr-centre" error={f.errors.centreId} hint="You can add more centres later.">
          <select id="tr-centre" className="field-input" value={v.centreId} onChange={(e) => setV({ ...v, centreId: e.target.value })}>
            <option value="">Choose a centre</option>
            {centres.data?.items.map((c) => <option key={c.id} value={c.id}>{centreLabel(c)}</option>)}
          </select>
        </Field>
        <div>
          <p className="field-label" id="tr-specs">Specialisations</p>
          <SkillAreaPicker id="tr-specs" value={specs} onChange={setSpecs} />
        </div>
      </form>
    </Modal>
  );
}

export function TrainerDetailPage() {
  const { id = '' } = useParams();
  const { can } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const centres = useCentres();
  const [decision, setDecision] = useState<'reject' | 'request-info' | null>(null);
  const [addCentre, setAddCentre] = useState('');
  const [editSpecs, setEditSpecs] = useState<string[] | null>(null);
  const q = useQuery({ queryKey: ['trainer', id], queryFn: () => api.get<TrainerDetail>(`/trainers/${id}`) });
  if (q.isLoading) return <Spinner />;
  if (q.isError) return <ErrorNote message={(q.error as Error).message} />;
  const t = q.data!;
  const manage = can('trainer.manage');
  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ['trainer'] });
    await qc.invalidateQueries({ queryKey: ['trainers'] });
  };
  const act = async (fn: () => Promise<unknown>, done: string) => {
    try {
      await fn();
      await refresh();
      toast('success', done);
    } catch (e) {
      toast('error', (e as Error).message);
    }
  };
  const available = (centres.data?.items ?? []).filter((c) => !t.centres.some((x) => x.id === c.id));

  return (
    <div>
      <Link to="/admin/trainers" className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-muted hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden />
        All trainers
      </Link>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-[26px] font-bold tracking-tight">{t.name}</h1>
            <StatusBadge status={t.verificationStatus} />
          </div>
          <p className="mt-1 text-muted">
            {[formatPhone(t.phone), t.email].filter(Boolean).join(', ')}
            <ChangePhoneButton userId={t.id} name={t.name} phone={t.phone} className="ml-2 text-sm font-medium text-brand hover:underline" />
          </p>
          {t.verificationReason && t.verificationStatus !== 'verified' && <p className="mt-1 text-sm text-warning">Reason: {t.verificationReason}</p>}
        </div>
        {manage && (
          <div className="flex flex-wrap gap-2">
            {t.verificationStatus !== 'verified' && (
              <button className="btn-primary" onClick={() => void act(() => api.post(`/admin/trainers/${t.id}/verify`), 'Trainer verified')}>Verify</button>
            )}
            {t.verificationStatus !== 'more_info_needed' && <button className="btn-secondary" onClick={() => setDecision('request-info')}>Ask for more information</button>}
            {t.verificationStatus !== 'rejected' && <button className="btn-secondary text-brand" onClick={() => setDecision('reject')}>Reject</button>}
          </div>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="card overflow-hidden">
          <h2 className="border-b border-line px-5 py-4 font-semibold">Centres</h2>
          <ul className="divide-y divide-line">
            {t.centres.map((c) => (
              <li key={c.assignmentId} className="px-5 py-3.5">
                <p className="font-medium">{c.name}</p>
                <p className="text-sm text-muted">{[c.city, c.organisationName ?? 'Run by VTA'].filter(Boolean).join(', ')}</p>
              </li>
            ))}
          </ul>
          {manage && available.length > 0 && (
            <form
              className="flex gap-2 border-t border-line px-5 py-4"
              onSubmit={(e) => {
                e.preventDefault();
                if (addCentre) void act(() => api.post(`/admin/trainers/${t.id}/centres`, { centreId: addCentre }), 'Centre added').then(() => setAddCentre(''));
              }}
            >
              <label htmlFor="add-centre" className="sr-only">Add a centre</label>
              <select id="add-centre" className="field-input" value={addCentre} onChange={(e) => setAddCentre(e.target.value)}>
                <option value="">Add another centre…</option>
                {available.map((c) => <option key={c.id} value={c.id}>{centreLabel(c)}</option>)}
              </select>
              <button className="btn-secondary" type="submit" disabled={!addCentre}>Add</button>
            </form>
          )}
          <p className="border-t border-line px-5 py-3 text-[13px] text-muted">To remove a centre, open the trainer’s user record and remove that role.</p>
        </section>

        <section className="card p-5">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">Specialisations</h2>
            {manage && editSpecs === null && <button className="btn-quiet btn-sm" onClick={() => setEditSpecs(t.specialisations)}>Edit</button>}
          </div>
          {editSpecs === null ? (
            <div className="mt-3"><SkillTags areas={t.specialisations} /></div>
          ) : (
            <div className="mt-3 space-y-3">
              <SkillAreaPicker id="edit-specs" value={editSpecs} onChange={setEditSpecs} />
              <div className="flex gap-2">
                <button className="btn-primary btn-sm" onClick={() => void act(() => api.patch(`/admin/trainers/${t.id}`, { specialisations: editSpecs }), 'Specialisations saved').then(() => setEditSpecs(null))}>Save</button>
                <button className="btn-secondary btn-sm" onClick={() => setEditSpecs(null)}>Cancel</button>
              </div>
            </div>
          )}
          <Link to={`/admin/users/${t.id}`} className="mt-6 inline-block text-sm font-semibold text-brand">Account and roles</Link>
        </section>
      </div>

      <section className="card mt-6 overflow-hidden">
        <h2 className="border-b border-line px-5 py-4 font-semibold">Batches</h2>
        {t.batches.length === 0 ? (
          <EmptyState title="No batches yet" body={t.verificationStatus === 'verified' ? undefined : 'A trainer must be verified before a batch can be assigned to them.'} />
        ) : (
          <ul className="divide-y divide-line">
            {t.batches.map((b) => (
              <li key={b.id}>
                <Link to={`/admin/batches/${b.id}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3.5 hover:bg-surface/60">
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">{b.name}</span>
                    <span className="block text-sm text-muted">{b.courseTitle}, {dateRange(b.startDate, b.endDate)}</span>
                  </span>
                  <StatusBadge status={b.status} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {decision && <ReasonModal title={decision === 'reject' ? `Reject ${t.name}?` : 'Ask for more information'} label={decision === 'reject' ? 'Why is this trainer rejected?' : 'What information is needed?'} action={decision === 'reject' ? 'Reject' : 'Send request'} onClose={() => setDecision(null)} onSubmit={(reason) => api.post(`/admin/trainers/${t.id}/${decision}`, { reason }).then(refresh).then(() => toast('success', decision === 'reject' ? 'Trainer rejected' : 'More information requested'))} />}
    </div>
  );
}

/** Shared "give a reason" dialog for decisions that must be explained (saved in the audit log). */
export function ReasonModal({ title, label, action, onClose, onSubmit, intro }: { title: string; label: string; action: string; onClose: () => void; onSubmit: (reason: string) => Promise<unknown>; intro?: string }) {
  const f = useForm(reasonSchema);
  const [reason, setReason] = useState('');
  return (
    <Modal
      open
      onClose={onClose}
      title={title}
      footer={
        <>
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" type="submit" form="reason-form" disabled={f.submitting}>{action}</button>
        </>
      }
    >
      <form
        id="reason-form"
        noValidate
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void f.submit({ reason }, async (d) => {
            await onSubmit(d.reason);
            onClose();
          });
        }}
      >
        {intro && <p className="text-sm">{intro}</p>}
        {f.formError && <ErrorNote message={f.formError} />}
        <Field label={label} htmlFor="reason-text" error={f.errors.reason} hint="Saved in the audit log.">
          <textarea id="reason-text" autoFocus rows={3} className="field-input h-auto py-2" value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      </form>
    </Modal>
  );
}
