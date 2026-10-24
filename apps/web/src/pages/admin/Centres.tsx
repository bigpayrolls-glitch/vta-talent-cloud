import { useQuery, useQueryClient } from '@tanstack/react-query';
import { centreSchema, type Page } from '@vta/shared';
import { Plus, Search } from 'lucide-react';
import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { EmptyState, ErrorNote, Field, Modal, PageHeader, Pagination, Spinner, StatusBadge } from '../../components/ui';
import { useToast } from '../../components/toast';
import { api, qs } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useForm } from '../../lib/useForm';

interface CentreRow {
  id: string;
  name: string;
  organisationId: string | null;
  organisationName: string | null;
  address: string | null;
  city: string | null;
  contactPhone: string | null;
  status: 'active' | 'inactive';
}

export function CentresPage() {
  const { can } = useAuth();
  const manage = can('centre.manage');
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState(params.get('q') ?? '');
  const [editing, setEditing] = useState<CentreRow | 'new' | null>(null);
  const filters = { q: params.get('q') ?? '', status: params.get('status') ?? '' };
  const page = Number(params.get('page') ?? 1);
  const q = useQuery({
    queryKey: ['centres', filters, page],
    queryFn: () => api.get<Page<CentreRow>>(`/centres${qs({ ...filters, page, pageSize: 20 })}`),
    placeholderData: (p) => p,
  });
  const set = (k: string, v: string) => {
    const n = new URLSearchParams(params);
    if (v) n.set(k, v);
    else n.delete(k);
    n.delete('page');
    setParams(n);
  };

  return (
    <div>
      <PageHeader
        title="Centres"
        description={manage ? 'Training centres run by VTA or by training partners.' : 'The centres you manage.'}
        actions={
          manage && (
            <button className="btn-primary" onClick={() => setEditing('new')}>
              <Plus className="size-4" aria-hidden />
              Add centre
            </button>
          )
        }
      />
      <div className="mb-4 flex flex-col gap-3 sm:flex-row">
        <form className="relative flex-1" role="search" onSubmit={(e) => { e.preventDefault(); set('q', search.trim()); }}>
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
          <label htmlFor="centre-search" className="sr-only">Search centres</label>
          <input id="centre-search" className="field-input pl-9" placeholder="Search by name or city" value={search} onChange={(e) => setSearch(e.target.value)} />
        </form>
        <label htmlFor="centre-status" className="sr-only">Status</label>
        <select id="centre-status" className="field-input sm:w-44" value={filters.status} onChange={(e) => set('status', e.target.value)}>
          <option value="">Any status</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
      </div>

      <div className="card overflow-hidden">
        {q.isLoading ? (
          <Spinner />
        ) : q.isError ? (
          <div className="p-4"><ErrorNote message={(q.error as Error).message} /></div>
        ) : q.data!.items.length === 0 ? (
          <EmptyState title="No centres found" body={manage ? 'Add the first centre so trainers and batches can be assigned to it.' : undefined} />
        ) : (
          <>
            <ul className="divide-y divide-line">
              {q.data!.items.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-4">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">{c.name}</p>
                    <p className="text-sm text-muted">
                      {[c.city, c.organisationName ?? 'Run by VTA'].filter(Boolean).join(', ')}
                    </p>
                  </div>
                  <StatusBadge status={c.status} />
                  {manage && (
                    <button className="btn-secondary btn-sm" onClick={() => setEditing(c)}>
                      Edit
                    </button>
                  )}
                </li>
              ))}
            </ul>
            <Pagination page={q.data!.page} pageSize={q.data!.pageSize} total={q.data!.total} onPage={(p) => { const n = new URLSearchParams(params); n.set('page', String(p)); setParams(n); }} />
          </>
        )}
      </div>
      {editing && <CentreModal centre={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function CentreModal({ centre, onClose }: { centre: CentreRow | null; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const f = useForm(centre ? centreSchema.partial() : centreSchema);
  const [v, setV] = useState({
    name: centre?.name ?? '',
    organisationId: centre?.organisationId ?? '',
    city: centre?.city ?? '',
    address: centre?.address ?? '',
    contactPhone: centre?.contactPhone ?? '',
  });
  const partners = useQuery({
    queryKey: ['partners-all'],
    queryFn: () => api.get<Page<{ id: string; legalName: string }>>(`/admin/organisations${qs({ type: 'partner', pageSize: 100 })}`),
  });
  const upd = (k: keyof typeof v) => (e: { target: { value: string } }) => setV({ ...v, [k]: e.target.value });

  const refresh = async (msg: string) => {
    await qc.invalidateQueries({ queryKey: ['centres'] });
    await qc.invalidateQueries({ queryKey: ['dashboard'] });
    toast('success', msg);
    onClose();
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={centre ? `Edit ${centre.name}` : 'Add centre'}
      footer={
        <>
          {centre && (
            <button
              className={`btn-secondary mr-auto ${centre.status === 'active' ? 'text-brand' : ''}`}
              onClick={() =>
                void api
                  .post(`/admin/centres/${centre.id}/${centre.status === 'active' ? 'deactivate' : 'activate'}`)
                  .then(() => refresh(centre.status === 'active' ? 'Centre deactivated' : 'Centre reactivated'))
                  .catch((e) => f.setFormError((e as Error).message))
              }
            >
              {centre.status === 'active' ? 'Deactivate' : 'Reactivate'}
            </button>
          )}
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" type="submit" form="centre-form" disabled={f.submitting}>
            {centre ? 'Save changes' : 'Add centre'}
          </button>
        </>
      }
    >
      <form
        id="centre-form"
        noValidate
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          const body = Object.fromEntries(Object.entries(v).filter(([, x]) => x !== ''));
          void f.submit(body, async (data) => {
            if (centre) await api.patch(`/admin/centres/${centre.id}`, data);
            else await api.post('/admin/centres', data);
            await refresh(centre ? 'Centre updated' : 'Centre added');
          });
        }}
      >
        {f.formError && <ErrorNote message={f.formError} />}
        <Field label="Centre name" htmlFor="c-name" error={f.errors.name}>
          <input id="c-name" autoFocus className="field-input" value={v.name} onChange={upd('name')} />
        </Field>
        <Field label="Run by" htmlFor="c-org" error={f.errors.organisationId} hint="Trainers can only be assigned to centres run by their own training partner.">
          <select id="c-org" className="field-input" value={v.organisationId} onChange={upd('organisationId')}>
            <option value="">VTA</option>
            {partners.data?.items.map((p) => <option key={p.id} value={p.id}>{p.legalName}</option>)}
          </select>
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="City" htmlFor="c-city" error={f.errors.city}>
            <input id="c-city" className="field-input" value={v.city} onChange={upd('city')} />
          </Field>
          <Field label="Contact mobile" htmlFor="c-phone" error={f.errors.contactPhone}>
            <input id="c-phone" type="tel" className="field-input" value={v.contactPhone} onChange={upd('contactPhone')} />
          </Field>
        </div>
        <Field label="Address" htmlFor="c-addr" error={f.errors.address}>
          <input id="c-addr" className="field-input" value={v.address} onChange={upd('address')} />
        </Field>
      </form>
    </Modal>
  );
}
