import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Award, BookOpen, CheckCircle2, Clock, UserCheck } from 'lucide-react';
import { Link } from 'react-router';
import { Spinner, StatusBadge } from '../../components/ui';
import { api } from '../../lib/api';
import { firstName, useAuth } from '../../lib/auth';
import { AttendanceMeter } from './Learning';
import type { LearnerCredential, LearnerProfile, LearningItem } from './types';

const VERIFY_TEXT: Record<LearnerProfile['verificationStatus'], string> = {
  pending: 'VTA is checking your details.',
  verified: 'Your details are verified by VTA.',
  needs_correction: 'VTA asked you to correct your details.',
  rejected: 'VTA could not verify your details.',
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
      <section className="rounded-[20px] bg-brand-tint px-6 py-7 sm:px-10">
        <h1 className="text-[28px] font-extrabold tracking-tight sm:text-[34px]">Hello, {firstName(me?.name ?? '')}!</h1>
        <p className="mt-1 text-lg text-ink/75">Keep learning. Build your career.</p>
        {p && (
          <p className="mt-4 inline-flex flex-wrap items-center gap-2 rounded-full bg-white px-3 py-1.5 text-sm">
            <span className="font-semibold">{p.candidateCode}</span>
            <StatusBadge status={p.verificationStatus} />
          </p>
        )}
      </section>

      {p && (
        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          <Link to="/learn/profile" className="card flex items-center gap-4 px-5 py-4 hover:border-brand">
            <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-surface">
              {p.completeness.pct === 100 ? <CheckCircle2 className="size-5 text-success" aria-hidden /> : <UserCheck className="size-5" aria-hidden />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-semibold">Profile {p.completeness.pct}% complete</span>
              <span className="block text-sm text-muted">{p.completeness.missing.length ? `Add: ${p.completeness.missing.slice(0, 3).join(', ')}` : VERIFY_TEXT[p.verificationStatus]}</span>
              <span className="mt-2 block h-1.5 overflow-hidden rounded-full bg-surface" aria-hidden>
                <span className="block h-full rounded-full bg-brand" style={{ width: `${p.completeness.pct}%` }} />
              </span>
            </span>
            <ArrowRight className="size-5 text-brand" aria-hidden />
          </Link>
          {p.verificationStatus === 'needs_correction' && (
            <Link to="/learn/profile" className="card flex items-center gap-4 border-warning bg-warning-tint px-5 py-4">
              <Clock className="size-5 shrink-0 text-warning" aria-hidden />
              <span className="min-w-0 flex-1 text-sm">
                <span className="block font-semibold text-ink">Please correct your details</span>
                {p.verificationReason}
              </span>
            </Link>
          )}
        </div>
      )}

      <section className="mt-8">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold">My course</h2>
          <Link to="/learn/learning" className="text-sm font-semibold text-brand">All learning</Link>
        </div>
        {learning.isLoading ? (
          <Spinner />
        ) : current ? (
          <article className="card mt-3 px-5 py-4">
            <p className="font-semibold">{current.course.title}</p>
            <p className="text-sm text-muted">{current.batch.name}, {current.centre.name}</p>
            <div className="mt-3">
              <AttendanceMeter item={current} />
            </div>
          </article>
        ) : (
          <p className="card mt-3 flex items-center gap-3 px-5 py-4 text-sm text-muted">
            <BookOpen className="size-5 shrink-0" aria-hidden />
            You are not in a running course. Your training centre will enrol you.
          </p>
        )}
      </section>

      <section className="mt-8">
        <h2 className="text-xl font-bold">Latest certificate</h2>
        {latest ? (
          <Link to={`/learn/certificates/${latest.id}`} className="card mt-3 flex items-center gap-4 px-5 py-4 hover:border-brand">
            <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-brand-tint text-brand">
              <Award className="size-5" aria-hidden />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-semibold">{latest.course}</span>
              <span className="block text-sm text-muted">{latest.typeLabel}</span>
            </span>
            <ArrowRight className="size-5 text-brand" aria-hidden />
          </Link>
        ) : (
          <p className="card mt-3 px-5 py-4 text-sm text-muted">Certificates appear here when you complete a course and pass its assessment.</p>
        )}
      </section>
    </>
  );
}
