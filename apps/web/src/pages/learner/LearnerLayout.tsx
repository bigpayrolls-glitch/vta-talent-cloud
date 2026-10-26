import { NOTICE_VERSION } from '@vta/shared';
import { Award, BookOpen, Briefcase, ClipboardList, FileText, Home, ShieldCheck, User } from 'lucide-react';
import { useState } from 'react';
import { Outlet } from 'react-router';
import { PortalLayout, type NavItem } from '../../components/PortalLayout';
import { ErrorNote } from '../../components/ui';
import { api, ApiError } from '../../lib/api';
import { firstName, useAuth } from '../../lib/auth';
import { PrivacyNotice, TermsOfUse } from '../public/NoticePages';

export const LEARNER_NAV: NavItem[] = [
  { to: '/learn', label: 'Home', icon: Home, bottom: true, end: true },
  { to: '/learn/learning', label: 'Learning', icon: BookOpen, bottom: true },
  { to: '/learn/jobs', label: 'Jobs', icon: Briefcase, bottom: true },
  { to: '/learn/applications', label: 'Applications', icon: ClipboardList },
  { to: '/learn/certificates', label: 'Certificates', icon: Award, bottom: true },
  { to: '/learn/profile', label: 'Profile', icon: User, bottom: true },
  { to: '/learn/documents', label: 'Documents', icon: FileText },
  { to: '/learn/privacy', label: 'Privacy', icon: ShieldCheck },
];

/** Learner portal (mobile-first). Nothing opens until the current privacy notice and terms are accepted (SH-05). */
export function LearnerLayout() {
  const { me } = useAuth();
  return <PortalLayout portal="learn" nav={me?.consentRequired ? [LEARNER_NAV[0]!] : LEARNER_NAV}>{me?.consentRequired ? <ConsentGate /> : <Outlet />}</PortalLayout>;
}

function ConsentGate() {
  const { me, refresh } = useAuth();
  const [privacy, setPrivacy] = useState(false);
  const [terms, setTerms] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<'privacy' | 'terms' | null>(null);

  const accept = async () => {
    if (!privacy || !terms) {
      setError('Tick both boxes to continue.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      for (const purpose of ['privacy_notice', 'terms'] as const) await api.post('/me/consents', { purpose, granted: true, noticeVersion: NOTICE_VERSION });
      await refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not save. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="mx-auto max-w-xl">
      <h1 className="text-[26px] font-bold tracking-tight">Welcome, {firstName(me?.name ?? '')}</h1>
      <p className="mt-2 text-muted">
        Your training centre created your VTA Talent Cloud account. Before you continue, please read how your information is used and agree to the terms.
      </p>
      <div className="card mt-6 divide-y divide-line">
        {(
          [
            ['privacy', 'Privacy notice', 'What we keep about you, who sees it and your choices.', privacy, setPrivacy, 'I have read the privacy notice'],
            ['terms', 'Terms of use', 'Rules for using your account and what VTA certificates mean.', terms, setTerms, 'I agree to the terms of use'],
          ] as const
        ).map(([key, title, body, checked, setChecked, label]) => (
          <div key={key} className="px-5 py-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-semibold">{title}</p>
                <p className="text-sm text-muted">{body}</p>
              </div>
              <button type="button" className="btn-secondary btn-sm shrink-0" aria-expanded={open === key} onClick={() => setOpen(open === key ? null : key)}>
                {open === key ? 'Hide' : 'Read'}
              </button>
            </div>
            {open === key && (
              <div className="mt-3 max-h-80 space-y-3 overflow-y-auto rounded-lg bg-surface/60 px-4 py-3 text-sm [&_h2]:mt-4 [&_h2]:font-bold [&_li]:ml-5 [&_li]:list-disc">
                {key === 'privacy' ? <PrivacyNotice /> : <TermsOfUse />}
              </div>
            )}
            <label className="mt-3 flex items-center gap-3 text-sm font-medium">
              <input type="checkbox" className="size-4 accent-[var(--color-brand)]" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
              {label}
            </label>
          </div>
        ))}
      </div>
      {error && (
        <div className="mt-4">
          <ErrorNote message={error} />
        </div>
      )}
      <button type="button" className="btn-primary mt-5 h-11 w-full sm:w-auto" disabled={busy} onClick={() => void accept()}>
        {busy ? 'Saving…' : 'Agree and continue'}
      </button>
      <p className="mt-3 text-[13px] text-muted">Draft wording for VTA review (version {NOTICE_VERSION}).</p>
    </section>
  );
}
