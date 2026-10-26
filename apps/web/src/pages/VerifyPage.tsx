import { useQuery } from '@tanstack/react-query';
import { BadgeCheck, CircleSlash, ShieldQuestion } from 'lucide-react';
import { useParams } from 'react-router';
import { Spinner, Wordmark } from '../components/ui';
import { api, ApiError } from '../lib/api';

interface Verification {
  type: string;
  holderName: string;
  courseTitle: string;
  issueDate: string;
  issuerName: string;
  status: 'active' | 'revoked' | 'superseded';
  statusChangedAt: string | null;
  disclaimer: string;
}

const day = (d: string) => new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(d.length === 10 ? `${d}T00:00:00` : d));

/**
 * Public page the QR code opens (AD-07). No sign-in. Shows only the approved fields:
 * holder name, course, issue date, issuer and status. Nothing else about the person.
 */
export function VerifyPage() {
  const { code = '' } = useParams();
  const q = useQuery({
    queryKey: ['verify', code],
    queryFn: () => api.get<Verification>(`/public/credentials/${code.toLowerCase().replace(/[^a-z0-9]/g, '')}`),
    retry: false,
  });
  const notFound = q.error instanceof ApiError && (q.error.status === 404 || q.error.status === 400);

  return (
    <div className="flex min-h-dvh flex-col bg-surface px-4 py-8">
      <header className="mx-auto w-full max-w-lg">
        <Wordmark tagline />
      </header>
      <main className="mx-auto my-auto w-full max-w-lg py-8">
        <h1 className="mb-4 text-sm font-semibold text-muted">Certificate check</h1>
        {q.isLoading ? (
          <Spinner label="Checking" />
        ) : notFound ? (
          <div className="card px-6 py-8 text-center">
            <ShieldQuestion className="mx-auto size-10 text-muted" aria-hidden />
            <p className="mt-3 text-lg font-bold">No certificate found</p>
            <p className="mt-1 text-sm text-muted">This code does not match any certificate. Check that the link or QR code was copied in full.</p>
          </div>
        ) : q.isError ? (
          <div className="card px-6 py-8 text-center text-sm text-muted">The check could not be completed. Try again in a minute.</div>
        ) : (
          <Result v={q.data!} />
        )}
      </main>
    </div>
  );
}

function Result({ v }: { v: Verification }) {
  const ok = v.status === 'active';
  return (
    <article className="card overflow-hidden">
      <div className={`flex items-center gap-3 px-6 py-4 ${ok ? 'bg-success-tint text-success' : 'bg-brand-tint text-brand'}`} role="status">
        {ok ? <BadgeCheck className="size-7 shrink-0" aria-hidden /> : <CircleSlash className="size-7 shrink-0" aria-hidden />}
        <div>
          <p className="text-lg font-bold">{ok ? 'Valid certificate' : v.status === 'revoked' ? 'This certificate has been revoked' : 'This certificate has been replaced'}</p>
          {!ok && v.statusChangedAt && <p className="text-sm">Since {day(v.statusChangedAt)}{v.status === 'superseded' ? '. A newer certificate was issued to the same person.' : '.'}</p>}
        </div>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-3 px-6 py-6 text-[15px]">
        <dt className="text-muted">Name</dt>
        <dd className="font-semibold">{v.holderName}</dd>
        <dt className="text-muted">Course</dt>
        <dd className="font-semibold">{v.courseTitle}</dd>
        <dt className="text-muted">Record</dt>
        <dd>{v.type}</dd>
        <dt className="text-muted">Issued</dt>
        <dd>{day(v.issueDate)}</dd>
        <dt className="text-muted">Issued by</dt>
        <dd>{v.issuerName}</dd>
      </dl>
      <p className="border-t border-line px-6 py-4 text-[13px] leading-relaxed text-muted">{v.disclaimer}</p>
    </article>
  );
}
