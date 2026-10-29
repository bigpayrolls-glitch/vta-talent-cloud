import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CONSENT_LABEL } from '@vta/shared';
import { Download, ExternalLink, UserX } from 'lucide-react';
import { useState } from 'react';
import { useToast } from '../../components/toast';
import { ErrorNote, Field, formatDate, Modal, PageHeader, Spinner } from '../../components/ui';
import { api, ApiError } from '../../lib/api';
import { t, tn } from '../../lib/i18n';
import type { ConsentView, LearnerProfile } from './types';

const when = (iso: string) => new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));

/** EE-10 / SH-05: the learner controls whether employers can find them, and sees every consent they have given. */
export function PrivacySettingsPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const profile = useQuery({ queryKey: ['me', 'profile'], queryFn: () => api.get<LearnerProfile>('/me/profile') });
  const consents = useQuery({ queryKey: ['me', 'consents'], queryFn: () => api.get<ConsentView>('/me/consents') });
  const [busy, setBusy] = useState(false);
  if (profile.isLoading || consents.isLoading) return <Spinner />;
  if (profile.isError || consents.isError) return <ErrorNote message={t('Could not load your privacy settings.')} />;
  const searchable = profile.data!.searchable;

  const set = async (granted: boolean) => {
    setBusy(true);
    try {
      await api.post('/me/consents', { purpose: 'profile_searchable', granted });
      await qc.invalidateQueries({ queryKey: ['me'] });
      toast('success', granted ? t('Employers can now find your profile') : t('Employers can no longer find your profile'));
    } catch (e) {
      toast('error', e instanceof ApiError ? e.message : t('Could not save'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader title={t('Privacy')} description={t('Choose who can find you, and see what you have agreed to.')} />
      <section className="card px-5 py-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <h2 id="searchable-label" className="font-semibold">
              {t('Employers can find my profile')}
            </h2>
            <p className="mt-1 text-sm text-muted">
              {t('When on, employers on AutoTalent Grid can find your profile in search: your name, city, skills, experience, languages, availability, AutoTalent Grid certificates, and the documents you let employers see. Your phone number and date of birth are not shown until you apply for a job.')}
            </p>
            <p className="mt-2 text-sm text-muted">{t('Turning it off stops future sharing. It cannot recall what an employer has already seen.')}</p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={searchable}
            aria-labelledby="searchable-label"
            disabled={busy}
            onClick={() => void set(!searchable)}
            className={`relative inline-flex h-8 w-14 shrink-0 items-center rounded-full transition-colors disabled:opacity-60 ${searchable ? 'bg-brand' : 'bg-line'}`}
          >
            <span className={`inline-block size-6 rounded-full bg-white shadow transition-transform ${searchable ? 'translate-x-7' : 'translate-x-1'}`} />
          </button>
        </div>
        <p className="mt-3 text-sm font-medium" aria-live="polite">
          {searchable ? t('Now: On, employers can find you') : t('Now: Off, employers cannot find you')}
        </p>
      </section>

      <section className="card mt-6 px-5 py-5">
        <h2 className="font-semibold">{t('What you agreed to')}</h2>
        <ul className="mt-2 space-y-1 text-sm">
          <li>
            <a href="/privacy" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-brand underline">
              {t('Privacy notice')} <ExternalLink className="size-3.5" aria-hidden />
            </a>
          </li>
          <li>
            <a href="/terms" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-brand underline">
              {t('Terms of use')} <ExternalLink className="size-3.5" aria-hidden />
            </a>
          </li>
        </ul>
        <h3 className="mt-5 text-sm font-semibold text-muted">{t('History')}</h3>
        <ul className="mt-2 divide-y divide-line text-sm">
          {consents.data!.history.map((h) => (
            <li key={h.id} className="flex flex-wrap justify-between gap-x-4 gap-y-0.5 py-2">
              <span>
                {tn('{purpose}: {state}', {
                  purpose: t(CONSENT_LABEL[h.purpose]),
                  state: <span className="font-semibold">{h.purpose === 'profile_searchable' ? (h.granted ? t('turned on') : t('turned off')) : t('accepted')}</span>,
                })}
                {h.noticeVersion && <span className="text-muted"> {t('(version {v})', { v: h.noticeVersion })}</span>}
                {h.source === 'migration' && <span className="text-muted"> {t('(set before this record was kept)')}</span>}
              </span>
              <span className="text-muted">{when(h.at)}</span>
            </li>
          ))}
        </ul>
      </section>

      <YourData />
    </>
  );
}

/** Phase 9: download everything kept about you, or ask VTA to close your account. */
function YourData() {
  const qc = useQueryClient();
  const toast = useToast();
  const closure = useQuery({ queryKey: ['me', 'closure'], queryFn: () => api.get<{ request: null | { id: string; reason: string | null; createdAt: string } }>('/me/closure-request') });
  const [downloading, setDownloading] = useState(false);
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const download = async () => {
    setDownloading(true);
    try {
      const res = await fetch('/api/v1/me/export', { credentials: 'include' });
      if (!res.ok) throw new Error();
      const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? 'my-data.json';
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast('error', t('Could not download your data. Try again.'));
    } finally {
      setDownloading(false);
    }
  };

  const act = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try {
      await fn();
      await qc.invalidateQueries({ queryKey: ['me'] });
      toast('success', done);
      setAsking(false);
    } catch (e) {
      toast('error', e instanceof ApiError ? e.message : t('Could not send. Try again.'));
    } finally {
      setBusy(false);
    }
  };

  const open = closure.data?.request;
  return (
    <>
      <section className="card mt-6 px-5 py-5">
        <h2 className="font-semibold">{t('Your data')}</h2>
        <p className="mt-1 text-sm text-muted">{t('One file with your profile, agreements, training, attendance, results, certificates, job applications and the list of your documents.')}</p>
        <button type="button" className="btn-secondary mt-4" onClick={() => void download()} disabled={downloading}>
          <Download className="size-4" aria-hidden />
          {downloading ? t('Preparing…') : t('Download my data')}
        </button>
      </section>

      <section className="card mt-6 px-5 py-5">
        <h2 className="font-semibold">{t('Close your account')}</h2>
        {closure.isLoading ? null : open ? (
          <>
            <p className="mt-1 text-sm">
              {tn('You asked AutoTalent Grid to close your account on {date}. Employers can no longer find your profile. AutoTalent Grid will close the account and withdraw any open job applications.', {
                date: <span className="font-semibold">{formatDate(open.createdAt)}</span>,
              })}
            </p>
            <button type="button" className="btn-secondary mt-4" disabled={busy} onClick={() => void act(() => api.post('/me/closure-request/cancel'), t('Request cancelled. Your account stays open.'))}>
              {t('Cancel my request')}
            </button>
          </>
        ) : (
          <>
            <p className="mt-1 text-sm text-muted">
              {t('AutoTalent Grid closes the account for you: you can no longer sign in, open applications are withdrawn and employers cannot find you. Your training records and certificates are kept, so they can still be checked.')}
            </p>
            <button type="button" className="btn-secondary mt-4 text-brand" onClick={() => setAsking(true)}>
              <UserX className="size-4" aria-hidden />
              {t('Ask to close my account')}
            </button>
          </>
        )}
      </section>

      <Modal
        open={asking}
        onClose={() => setAsking(false)}
        title={t('Ask AutoTalent Grid to close your account?')}
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setAsking(false)}>
              {t('Keep my account')}
            </button>
            <button type="button" className="btn-primary" disabled={busy} onClick={() => void act(() => api.post('/me/closure-request', reason.trim() ? { reason: reason.trim() } : {}), t('Request sent to AutoTalent Grid.'))}>
              {busy ? t('Sending…') : t('Send request')}
            </button>
          </>
        }
      >
        <p className="text-sm">{t('Employers stop seeing your profile straight away. You can cancel until AutoTalent Grid closes the account. Download your data first if you want a copy.')}</p>
        <div className="mt-4">
          <Field label={t('Reason (optional)')} htmlFor="closure-reason">
            <textarea id="closure-reason" className="field-input min-h-20" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
        </div>
      </Modal>
    </>
  );
}
