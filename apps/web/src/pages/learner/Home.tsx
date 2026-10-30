import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Award, BookOpen, Briefcase, CheckCircle2, Clock, Search, UserCheck } from 'lucide-react';
import { Link } from 'react-router';
import { Spinner, StatusBadge } from '../../components/ui';
import { HeroBanner, heroPrimary, heroSecondary, StatCard, StatRow } from '../../components/Showroom';
import { api } from '../../lib/api';
import { firstName, useAuth } from '../../lib/auth';
import { t } from '../../lib/i18n';
import { AttendanceMeter } from './Learning';
import type { LearnerCredential, LearnerProfile, LearningItem } from './types';

const VERIFY_TEXT: Record<LearnerProfile['verificationStatus'], string> = {
  pending: 'AutoTalent Grid is checking your details.',
  verified: 'Your details are verified by AutoTalent Grid.',
  needs_correction: 'AutoTalent Grid asked you to correct your details.',
  rejected: 'AutoTalent Grid could not verify your details.',
};

/** Learner home: who they are, what to do next, the current course and the latest certificate. */
export function LearnerHomePage() {
  const { me } = useAuth();
  const profile = useQuery({ queryKey: ['me', 'profile'], queryFn: () => api.get<LearnerProfile>('/me/profile') });
  const learning = useQuery({ queryKey: ['me', 'learning'], queryFn: () => api.get<{ items: LearningItem[] }>('/me/learning') });
  const creds = useQuery({ queryKey: ['me', 'credentials'], queryFn: () => api.get<{ items: LearnerCredential[] }>('/me/credentials') });
  if (profile.isLoading) return <Spinner />;
  const p = profile.data;
  const current = learning.data?.items.find((i) => i.enrolmentStatus === 'enrolled');
  const latest = creds.data?.items.find((c) => c.status === 'active');

  return (
    <>
      <HeroBanner
        eyebrow="AutoTalent Grid"
        title={t('Hello, {name}!', { name: firstName(me?.name ?? '') })}
        subtitle={t('Keep learning. Build your career.')}
        floating={!!p}
        actions={
          <>
            <Link to="/learn/jobs" className={heroPrimary}>
              <Briefcase className="size-4" aria-hidden />
              {t('Find jobs')}
            </Link>
            <Link to="/courses" className={heroSecondary}>
              <Search className="size-4" aria-hidden />
              {t('Find a course')}
            </Link>
          </>
        }
      >
        {p && (
          <p className="mt-4 inline-flex flex-wrap items-center gap-2 rounded-full bg-white px-3 py-1.5 text-sm text-ink">
            <span className="font-semibold">{p.candidateCode}</span>
            <StatusBadge status={p.verificationStatus} />
          </p>
        )}
      </HeroBanner>

      {p && (
        <StatRow cols={3}>
          <StatCard icon={UserCheck} label={t('Profile')} value={`${p.completeness.pct}%`} to="/learn/profile" />
          <StatCard icon={BookOpen} label={t('My Courses')} value={learning.data ? learning.data.items.length : '…'} to="/learn/learning" />
          <StatCard icon={Award} label={t('Certificates')} value={creds.data ? creds.data.items.filter((c) => c.status === 'active').length : '…'} to="/learn/certificates" highlight />
        </StatRow>
      )}

      {p && (
        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          <Link to="/learn/profile" className="flex items-center gap-4 rounded-[22px] bg-white px-5 py-4 transition-transform hover:-translate-y-0.5">
            <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-surface">
              {p.completeness.pct === 100 ? <CheckCircle2 className="size-5 text-success" aria-hidden /> : <UserCheck className="size-5" aria-hidden />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-semibold">{t('Profile {pct}% complete', { pct: p.completeness.pct })}</span>
              <span className="block text-sm text-muted">{p.completeness.missing.length ? t('Add: {items}', { items: p.completeness.missing.slice(0, 3).map((m) => t(m)).join(', ') }) : t(VERIFY_TEXT[p.verificationStatus])}</span>
              <span className="mt-2 block h-1.5 overflow-hidden rounded-full bg-surface" aria-hidden>
                <span className="block h-full rounded-full bg-brand" style={{ width: `${p.completeness.pct}%` }} />
              </span>
            </span>
            <ArrowRight className="size-5 text-brand" aria-hidden />
          </Link>
          {p.verificationStatus === 'needs_correction' && (
            <Link to="/learn/profile" className="flex items-center gap-4 rounded-[22px] border border-warning bg-warning-tint px-5 py-4">
              <Clock className="size-5 shrink-0 text-warning" aria-hidden />
              <span className="min-w-0 flex-1 text-sm">
                <span className="block font-semibold text-ink">{t('Please correct your details')}</span>
                {p.verificationReason}
              </span>
            </Link>
          )}
        </div>
      )}

      <div className="mt-6 grid gap-5 lg:grid-cols-2">
      <section className="min-w-0 rounded-[22px] bg-white p-5 sm:p-6">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-[18px] font-extrabold">{t('My course')}</h2>
          <Link to="/learn/learning" className="text-sm font-semibold text-brand">{t('All learning')}</Link>
        </div>
        {learning.isLoading ? (
          <Spinner />
        ) : current ? (
          <article className="mt-3 rounded-[18px] border border-[#E3E6EA] px-4 py-4">
            <p className="font-semibold">{current.course.title}</p>
            <p className="text-sm text-muted">{current.batch.name}, {current.centre.name}</p>
            <div className="mt-3">
              <AttendanceMeter item={current} />
            </div>
          </article>
        ) : (
          <p className="mt-3 flex items-center gap-3 text-sm text-muted">
            <BookOpen className="size-5 shrink-0" aria-hidden />
            {t('You are not in a running course. Your training centre will enrol you.')}
          </p>
        )}
      </section>

      <section className="min-w-0 rounded-[22px] bg-white p-5 sm:p-6">
        <h2 className="font-display text-[18px] font-extrabold">{t('Latest certificate')}</h2>
        {latest ? (
          <Link to={`/learn/certificates/${latest.id}`} className="mt-3 flex items-center gap-4 rounded-[18px] border border-[#E3E6EA] px-4 py-4 hover:border-brand">
            <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-brand-tint text-brand">
              <Award className="size-5" aria-hidden />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-semibold">{latest.course}</span>
              <span className="block text-sm text-muted">{t(latest.typeLabel)}</span>
            </span>
            <ArrowRight className="size-5 text-brand" aria-hidden />
          </Link>
        ) : (
          <p className="mt-3 text-sm text-muted">{t('Certificates appear here when you complete a course and pass its assessment.')}</p>
        )}
      </section>
      </div>
    </>
  );
}
