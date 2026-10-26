import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Copy, ExternalLink, Printer } from 'lucide-react';
import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { SearchBox, Select } from '../../components/form';
import { useToast } from '../../components/toast';
import { EmptyState, ErrorNote, formatDate, PageHeader, Pagination, Spinner, StatusBadge, Wordmark } from '../../components/ui';
import { api, qs } from '../../lib/api';
import { useListParams } from '../../lib/useListParams';
import { ReasonModal } from '../training/Trainers';

interface CredentialRow {
  id: string;
  holderName: string;
  candidateCode: string;
  courseTitle: string;
  issueDate: string;
  status: string;
  batch: { id: string; name: string };
}
interface CredentialDetail extends CredentialRow {
  type: string;
  candidateId: string;
  issuerName: string;
  verificationCode: string;
  verifyPath: string;
  issuedByName: string | null;
  revokedReason: string | null;
  revokedAt: string | null;
  revokedByName: string | null;
  supersededBy: string | null;
  disclaimer: string;
  canManage: boolean;
}

const day = (d: string) => new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(`${d}T00:00:00`));
/** Groups the 32-character code in fours so it can be read out or typed. */
export const groupCode = (c: string) => c.toUpperCase().match(/.{1,4}/g)!.join(' ');

export function CredentialsPage() {
  const { values, page, set, setPage } = useListParams(['q', 'status'] as const);
  const q = useQuery({
    queryKey: ['credentials', values, page],
    queryFn: () => api.get<{ items: CredentialRow[]; page: number; pageSize: number; total: number }>(`/admin/credentials${qs({ ...values, page, pageSize: 20 })}`),
    placeholderData: (p) => p,
  });
  return (
    <div>
      <PageHeader title="Certificates" description="Course completion records issued on the platform. Each has a QR code anyone can scan to check it." />
      <div className="mb-4 flex flex-col gap-3 sm:flex-row">
        <SearchBox initial={values.q} onSearch={(v) => set('q', v)} placeholder="Search by name, candidate ID or course" label="Search certificates" />
        <Select id="cr-status" label="Status" className="sm:w-44" value={values.status} onChange={(v) => set('status', v)} options={[{ value: '', label: 'Any status' }, { value: 'active', label: 'Active' }, { value: 'revoked', label: 'Revoked' }, { value: 'superseded', label: 'Replaced' }]} />
      </div>
      <div className="card overflow-hidden">
        {q.isLoading ? (
          <Spinner />
        ) : q.isError ? (
          <div className="p-4"><ErrorNote message={(q.error as Error).message} /></div>
        ) : q.data!.items.length === 0 ? (
          <EmptyState title="No certificates yet" body="Issue them from a completed batch." />
        ) : (
          <>
            <ul className="divide-y divide-line">
              {q.data!.items.map((c) => (
                <li key={c.id}>
                  <Link to={`/admin/credentials/${c.id}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-4 hover:bg-surface/60">
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold">{c.holderName} <span className="font-normal text-muted">{c.candidateCode}</span></span>
                      <span className="block text-sm text-muted">{c.courseTitle}, issued {day(c.issueDate)}</span>
                    </span>
                    <StatusBadge status={c.status === 'superseded' ? 'replaced' : c.status} />
                  </Link>
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

function useQr(text: string) {
  const [src, setSrc] = useState('');
  useEffect(() => {
    if (!text) return;
    void QRCode.toDataURL(text, { margin: 1, width: 280, color: { dark: '#202124', light: '#ffffff' } }).then(setSrc);
  }, [text]);
  return src;
}

export function CredentialDetailPage() {
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const [action, setAction] = useState<'revoke' | 'reissue' | null>(null);
  const q = useQuery({ queryKey: ['credential', id], queryFn: () => api.get<CredentialDetail>(`/admin/credentials/${id}`) });
  const verifyUrl = q.data ? `${window.location.origin}${q.data.verifyPath}` : '';
  const qr = useQr(verifyUrl);
  if (q.isLoading) return <Spinner />;
  if (q.isError) return <ErrorNote message={(q.error as Error).message} />;
  const c = q.data!;
  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ['credential'] });
    await qc.invalidateQueries({ queryKey: ['credentials'] });
  };

  return (
    <div>
      <Link to="/admin/credentials" className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-muted hover:text-ink print:hidden">
        <ArrowLeft className="size-4" aria-hidden />
        All certificates
      </Link>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4 print:hidden">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-[26px] font-bold tracking-tight">{c.holderName}</h1>
            <StatusBadge status={c.status === 'superseded' ? 'replaced' : c.status} />
          </div>
          <p className="mt-1 text-muted">
            {c.courseTitle}, <Link className="hover:text-ink hover:underline" to={`/admin/batches/${c.batch.id}`}>{c.batch.name}</Link>. Issued by {c.issuedByName ?? '—'}.
          </p>
          {c.status !== 'active' && (
            <p className="mt-1 text-sm text-warning">
              {c.status === 'revoked' ? 'Revoked' : 'Replaced'} {formatDate(c.revokedAt)} by {c.revokedByName}: {c.revokedReason}
              {c.supersededBy && (
                <>
                  {' '}
                  <Link className="font-semibold underline" to={`/admin/credentials/${c.supersededBy}`}>See the new certificate</Link>
                </>
              )}
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="btn-secondary" onClick={() => window.print()}>
            <Printer className="size-4" aria-hidden />
            Print
          </button>
          {c.canManage && c.status === 'active' && (
            <>
              <button className="btn-secondary" onClick={() => setAction('reissue')}>Reissue</button>
              <button className="btn-secondary text-brand" onClick={() => setAction('revoke')}>Revoke</button>
            </>
          )}
        </div>
      </div>

      {/* The printable record */}
      <article className="card mx-auto max-w-3xl overflow-hidden print:border-0">
        <div className="h-2 bg-brand" aria-hidden />
        <div className="px-8 py-8 sm:px-12">
          <div className="flex items-start justify-between gap-6">
            <Wordmark />
            <p className="text-right text-sm text-muted">{c.type}</p>
          </div>
          <p className="mt-10 text-sm text-muted">This is to record that</p>
          <p className="mt-1 text-[32px] font-extrabold leading-tight tracking-tight">{c.holderName}</p>
          <p className="mt-4 text-sm text-muted">completed the course and passed its assessment</p>
          <p className="mt-1 text-xl font-bold">{c.courseTitle}</p>
          <div className="mt-10 grid gap-6 sm:grid-cols-[1fr_auto] sm:items-end">
            <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-sm">
              <dt className="text-muted">Issued</dt>
              <dd className="font-medium">{day(c.issueDate)}</dd>
              <dt className="text-muted">Issued by</dt>
              <dd className="font-medium">{c.issuerName}</dd>
              <dt className="text-muted">Candidate ID</dt>
              <dd className="font-medium">{c.candidateCode}</dd>
              <dt className="text-muted">Check code</dt>
              <dd className="font-mono text-[13px]">{groupCode(c.verificationCode)}</dd>
            </dl>
            <figure className="text-center">
              {qr ? <img src={qr} alt={`QR code that opens the check page for this certificate`} className="mx-auto size-36" /> : <div className="size-36" />}
              <figcaption className="mt-1 text-xs text-muted">Scan to check</figcaption>
            </figure>
          </div>
          <p className="mt-8 border-t border-line pt-4 text-[12px] leading-relaxed text-muted">{c.disclaimer}</p>
        </div>
      </article>

      <div className="mx-auto mt-4 flex max-w-3xl flex-wrap items-center gap-2 print:hidden">
        <code className="min-w-0 flex-1 truncate rounded-lg bg-surface px-3 py-2 text-[13px]">{verifyUrl}</code>
        <button className="btn-secondary btn-sm" onClick={() => void navigator.clipboard.writeText(verifyUrl).then(() => toast('success', 'Link copied'))}>
          <Copy className="size-4" aria-hidden />
          Copy link
        </button>
        <a className="btn-secondary btn-sm" href={c.verifyPath} target="_blank" rel="noreferrer">
          <ExternalLink className="size-4" aria-hidden />
          Open check page
        </a>
      </div>

      {action === 'revoke' && (
        <ReasonModal
          title="Revoke this certificate?"
          label="Why is it revoked?"
          action="Revoke"
          intro="Anyone who scans the QR code will see that it has been revoked. This cannot be undone."
          onClose={() => setAction(null)}
          onSubmit={(reason) => api.post(`/admin/credentials/${c.id}/revoke`, { reason }).then(refresh).then(() => toast('success', 'Certificate revoked'))}
        />
      )}
      {action === 'reissue' && (
        <ReasonModal
          title="Reissue this certificate?"
          label="Why is it reissued?"
          action="Reissue"
          intro="A new certificate is created with the candidate’s current name and a new QR code. This one will show as replaced."
          onClose={() => setAction(null)}
          onSubmit={(reason) =>
            api.post<{ id: string }>(`/admin/credentials/${c.id}/reissue`, { reason }).then(async (r) => {
              await refresh();
              toast('success', 'New certificate issued');
              navigate(`/admin/credentials/${r.id}`);
            })
          }
        />
      )}
    </div>
  );
}
