import { useQuery } from '@tanstack/react-query';
import { BadgeCheck, CircleSlash, ShieldQuestion } from 'lucide-react';
import { useParams, Link } from 'react-router';
import { LanguagePicker } from '../components/LanguagePicker';
import { Spinner, Wordmark } from '../components/ui';
import { api, ApiError } from '../lib/api';
import { t } from '../lib/i18n';

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
      <header className="mx-auto flex w-full max-w-lg flex-wrap items-center gap-3">
        <Link to="/" aria-label={t('AutoTalent Grid home')} className="inline-block w-fit rounded-lg">
            <Wordmark tagline />
          </Link>
        <div className="ml-auto">
          <LanguagePicker compact />
        </div>
      </header>
      <main className="mx-auto my-auto w-full max-w-lg py-8">
        <h1 className="mb-4 text-sm font-semibold text-muted">{t('Certificate check')}</h1>
        {q.isLoading ? (
          <Spinner label={t('Checking')} />
        ) : notFound ? (
          <div className="card px-6 py-8 text-center">
            <ShieldQuestion className="mx-auto size-10 text-muted" aria-hidden />
            <p className="mt-3 text-lg font-bold">{t('No certificate found')}</p>
            <p className="mt-1 text-sm text-muted">{t('This code does not match any certificate. Check that the link or QR code was copied in full.')}</p>
          </div>
        ) : q.isError ? (
          <div className="card px-6 py-8 text-center text-sm text-muted">{t('The check could not be completed. Try again in a minute.')}</div>
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
          <p className="text-lg font-bold">{ok ? t('Valid certificate') : v.status === 'revoked' ? t('This certificate has been revoked') : t('This certificate has been replaced')}</p>
          {!ok && v.statusChangedAt && <p className="text-sm">{v.status === 'superseded' ? t('Since {date}. A newer certificate was issued to the same person.', { date: day(v.statusChangedAt) }) : t('Since {date}.', { date: day(v.statusChangedAt) })}</p>}
        </div>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-3 px-6 py-6 text-[15px]">
        <dt className="text-muted">{t('Name')}</dt>
        <dd className="font-semibold">{v.holderName}</dd>
        <dt className="text-muted">{t('Course')}</dt>
        <dd className="font-semibold">{v.courseTitle}</dd>
        <dt className="text-muted">{t('Record')}</dt>
        <dd>{v.type}</dd>
        <dt className="text-muted">{t('Issued')}</dt>
        <dd>{day(v.issueDate)}</dd>
        <dt className="text-muted">{t('Issued by')}</dt>
        <dd>{v.issuerName}</dd>
      </dl>
      <p className="border-t border-line px-6 py-4 text-[13px] leading-relaxed text-muted">{v.disclaimer}</p>
    </article>
  );
}
