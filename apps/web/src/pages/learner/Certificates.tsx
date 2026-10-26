import { useQuery } from '@tanstack/react-query';
import { CREDENTIAL_DISCLAIMER } from '@vta/shared';
import { ArrowLeft, Award, ExternalLink, Info, Printer } from 'lucide-react';
import { Link, useParams } from 'react-router';
import { EmptyState, ErrorNote, PageHeader, Spinner } from '../../components/ui';
import { api } from '../../lib/api';
import { useQr } from '../../lib/useQr';
import { fmtDate } from './attendance';
import type { LearnerCredential } from './types';

const STATUS: Record<LearnerCredential['status'], { label: string; className: string }> = {
  active: { label: 'Valid', className: 'bg-success-tint text-success' },
  revoked: { label: 'Revoked', className: 'bg-brand-tint text-brand' },
  superseded: { label: 'Replaced by a newer copy', className: 'bg-surface text-muted' },
};

function Status({ s }: { s: LearnerCredential['status'] }) {
  return <span className={`rounded-full px-2.5 py-1 text-[13px] font-semibold ${STATUS[s].className}`}>{STATUS[s].label}</span>;
}

/** EE-06: the learner's certificate wallet. VTA completion records are labelled as such, never as official qualifications. */
export function WalletPage() {
  const q = useQuery({ queryKey: ['me', 'credentials'], queryFn: () => api.get<{ items: LearnerCredential[] }>('/me/credentials') });
  return (
    <>
      <PageHeader title="My certificates" description="Share the QR code or check link with an employer so they can confirm a certificate is real." />
      <p className="mb-5 flex items-start gap-2 rounded-lg bg-info-tint px-3 py-2 text-sm text-info">
        <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
        These are VTA course completion records. They are not government, NSDC or ASDC qualifications.
      </p>
      {q.isLoading ? (
        <Spinner />
      ) : q.isError ? (
        <ErrorNote message={(q.error as Error).message} />
      ) : !q.data!.items.length ? (
        <EmptyState title="No certificates yet" body="When you complete a course and pass its assessment, VTA issues a certificate and it appears here." />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {q.data!.items.map((c) => (
            <li key={c.id}>
              <Link to={`/learn/certificates/${c.id}`} className={`card flex h-full items-start gap-4 px-5 py-4 hover:border-brand ${c.status !== 'active' ? 'opacity-80' : ''}`}>
                <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-brand-tint text-brand">
                  <Award className="size-5" aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">{c.course}</span>
                  <span className="block text-sm text-muted">
                    {c.typeLabel}, issued {fmtDate(c.issueDate)}
                  </span>
                  <span className="mt-2 inline-block">
                    <Status s={c.status} />
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

export function CertificatePage() {
  const { id = '' } = useParams();
  const q = useQuery({ queryKey: ['me', 'credential', id], queryFn: () => api.get<LearnerCredential>(`/me/credentials/${id}`) });
  const verifyUrl = q.data ? `${window.location.origin}${q.data.verifyPath}` : '';
  const qr = useQr(q.data?.status === 'active' ? verifyUrl : '');
  return (
    <>
      <Link to="/learn/certificates" className="inline-flex items-center gap-1.5 text-sm font-medium text-muted hover:text-ink print:hidden">
        <ArrowLeft className="size-4" aria-hidden />
        My certificates
      </Link>
      {q.isLoading ? (
        <Spinner />
      ) : q.isError ? (
        <div className="mt-4">
          <ErrorNote message={(q.error as Error).message} />
        </div>
      ) : (
        (() => {
          const c = q.data!;
          return (
            <>
              <article className="card mx-auto mt-4 max-w-xl px-6 py-7 text-center print:border-0">
                <p className="text-[13px] font-semibold uppercase tracking-wide text-muted">{c.typeLabel}</p>
                <h1 className="mt-2 text-2xl font-bold tracking-tight">{c.holderName}</h1>
                <p className="mt-1 text-muted">completed</p>
                <p className="mt-1 text-xl font-semibold">{c.course}</p>
                <p className="mt-3 text-sm text-muted">
                  Issued {fmtDate(c.issueDate)} by {c.issuer}
                </p>
                <div className="mt-4">
                  <Status s={c.status} />
                </div>
                {c.status === 'active' ? (
                  qr && <img src={qr} alt="QR code that opens this certificate's check page" className="mx-auto mt-5 size-52" />
                ) : (
                  <p className="mt-5 text-sm text-muted">
                    {c.status === 'revoked' ? 'This certificate is no longer valid. Contact your training centre if you think this is wrong.' : 'A corrected copy was issued.'}
                    {c.replacedBy && (
                      <>
                        {' '}
                        <Link to={`/learn/certificates/${c.replacedBy}`} className="font-medium text-brand underline">
                          Open the newer copy
                        </Link>
                      </>
                    )}
                  </p>
                )}
                <p className="mt-5 text-[13px] text-muted">{CREDENTIAL_DISCLAIMER}</p>
              </article>
              {c.status === 'active' && (
                <div className="mx-auto mt-4 flex max-w-xl flex-wrap justify-center gap-2 print:hidden">
                  <a href={c.verifyPath} target="_blank" rel="noreferrer" className="btn-secondary">
                    <ExternalLink className="size-4" aria-hidden />
                    Open check page
                  </a>
                  <button type="button" className="btn-secondary" onClick={() => window.print()}>
                    <Printer className="size-4" aria-hidden />
                    Print
                  </button>
                </div>
              )}
            </>
          );
        })()
      )}
    </>
  );
}
