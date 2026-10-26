// ---------------------------------------------------------------------------
// Phase 9: in-app notifications (SH-07).
// A notification stores a template key and its values; the wording is rendered when it is read, so it can be
// improved later without rewriting history. No personal data beyond what the recipient may already see.
// Delivery by SMS/WhatsApp/email waits for the provider decision (D10); every notification is in-app today.
// ---------------------------------------------------------------------------

type P = Record<string, string>;

interface Template {
  title: (p: P) => string;
  body?: (p: P) => string;
}

const APPLICATION_UPDATE: Record<string, { title: (p: P) => string; body: (p: P) => string }> = {
  shortlisted: { title: (p) => `You're shortlisted for ${p.job}`, body: (p) => `${p.company} shortlisted your application. They may contact you about an interview.` },
  interview: { title: (p) => `Interview stage: ${p.job}`, body: (p) => `${p.company} moved your application to the interview stage.` },
  offer: { title: (p) => `Job offer from ${p.company}`, body: (p) => `${p.company} made you an offer for ${p.job}. Open the application for details.` },
  joined: { title: (p) => `Joining recorded: ${p.job}`, body: (p) => `${p.company} recorded that you joined. VTA will confirm it.` },
  not_joined: { title: (p) => `Update on ${p.job}`, body: (p) => `${p.company} recorded that you did not join.` },
  rejected: { title: (p) => `Update on ${p.job}`, body: (p) => `${p.company} has decided not to go ahead with your application. Keep applying: new jobs are added often.` },
};

export const NOTIFICATION_TEMPLATES = {
  // Learners
  application_update: {
    title: (p) => APPLICATION_UPDATE[p.status ?? '']?.title(p) ?? `Update on ${p.job}`,
    body: (p) => APPLICATION_UPDATE[p.status ?? '']?.body(p) ?? `Your application status changed.`,
  },
  interview_scheduled: { title: (p) => `Interview for ${p.job}`, body: (p) => `${p.company} scheduled an interview (${p.mode}) on ${p.when}.` },
  job_invitation: { title: (p) => `${p.company} invited you to apply`, body: (p) => `For the job ${p.job}. Have a look and apply if it suits you.` },
  enrolled: { title: (p) => `You're enrolled in ${p.course}`, body: (p) => `Batch ${p.batch} starts on ${p.start}.` },
  result_released: { title: (p) => `Your result for ${p.course} is ready`, body: (p) => (p.outcome === 'pass' ? 'You passed. Your certificate follows once VTA issues it.' : 'Open it to see your marks.') },
  certificate_issued: { title: (p) => `Your certificate for ${p.course} is ready`, body: () => 'Share it with employers, or let them check it with its QR code.' },
  profile_verified: { title: () => 'VTA verified your profile', body: () => 'Employers can now find you if you allow it in Privacy.' },
  document_rejected: { title: (p) => `VTA could not accept "${p.title}"`, body: (p) => `VTA's note: ${p.reason}. You can upload a clearer copy.` },
  profile_rejected: { title: () => 'VTA could not verify your profile', body: (p) => `VTA's note: ${p.reason}` },
  profile_correction: { title: () => 'VTA asked you to correct your profile', body: (p) => `VTA's note: ${p.reason}` },
  // Trainers
  batch_assigned: { title: (p) => `You're the trainer for ${p.batch}`, body: (p) => `${p.course}, starting ${p.start}.` },
  result_returned: { title: (p) => `${p.learner}'s result in ${p.batch} needs changes`, body: (p) => `VTA's note: ${p.reason}` },
  result_rejected: { title: (p) => `${p.learner}'s result in ${p.batch} was not accepted`, body: (p) => `VTA's note: ${p.reason}` },
  // Employers
  application_received: { title: (p) => `New application for ${p.job}`, body: () => 'Open the job to review it.' },
  application_withdrawn: { title: (p) => `An application for ${p.job} was withdrawn`, body: () => 'The candidate withdrew it.' },
  job_published: { title: (p) => `${p.job} is live`, body: () => 'VTA approved it. Learners can now see and apply.' },
  job_paused: { title: (p) => `VTA paused ${p.job}`, body: (p) => (p.reason ? `VTA's note: ${p.reason}` : 'It is hidden from learners for now.') },
  job_rejected: { title: (p) => `VTA could not publish ${p.job}`, body: (p) => `VTA's note: ${p.reason}` },
  // Employers and partners
  org_verified: { title: (p) => `${p.org} is verified`, body: (p) => (p.type === 'employer' ? 'You can now post jobs and search candidates.' : 'VTA can now link you to programmes.') },
  org_more_info: { title: () => 'VTA needs more information', body: (p) => `VTA's note: ${p.reason}` },
  org_rejected: { title: (p) => `VTA could not verify ${p.org}`, body: (p) => `VTA's note: ${p.reason}` },
  programme_assigned: { title: (p) => `You're a partner on ${p.programme}`, body: () => 'Open it to see the dashboard, beneficiaries and documents.' },
  // VTA staff
  org_submitted: { title: (p) => `${p.org} sent for verification`, body: (p) => (p.type === 'employer' ? 'An employer is waiting to be verified.' : 'A training partner is waiting to be verified.') },
  job_submitted: { title: (p) => `Job waiting for review: ${p.job}`, body: (p) => `From ${p.company}.` },
  joining_reported: { title: (p) => `Joining to verify: ${p.job}`, body: (p) => `${p.company} recorded a joining.` },
  account_closure_requested: { title: () => 'A learner asked to close their account', body: () => 'Open Users to review the request.' },
} satisfies Record<string, Template>;

export type NotificationTemplate = keyof typeof NOTIFICATION_TEMPLATES;

export function renderNotification(template: string, params: P): { title: string; body: string } {
  const t = (NOTIFICATION_TEMPLATES as Record<string, Template>)[template];
  if (!t) return { title: 'Update', body: '' };
  return { title: t.title(params), body: t.body?.(params) ?? '' };
}

export interface NotificationDto {
  id: string;
  template: string;
  title: string;
  body: string;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}
