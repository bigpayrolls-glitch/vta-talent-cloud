// First: see zod-config.ts.
import './zod-config';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router';
import { ToastProvider } from './components/toast';
import { UpdatePrompt } from './components/UpdatePrompt';
import { AuthProvider } from './lib/auth';
import { currentLang, initI18n, onLangChange } from './lib/i18n';
import { AcceptInvitation, ChoosePortal, NoAccess, NotFound, RequirePortal } from './pages/AccessPages';
import { LoginPage } from './pages/LoginPage';
import { PartnerLayout } from './pages/PortalHomes';
import './styles.css';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

const router = createBrowserRouter([
  // Public site (Phase 8). Signed-in people are sent on to their portal.
  { path: '/', lazy: () => import('./pages/public/Home').then((m) => ({ Component: m.PublicHomePage })) },
  { path: '/courses', lazy: () => import('./pages/public/Courses').then((m) => ({ Component: m.CoursesPage })) },
  { path: '/courses/:id', lazy: () => import('./pages/public/Courses').then((m) => ({ Component: m.CourseDetailPage })) },
  { path: '/enrol/done/:id', lazy: () => import('./pages/public/Courses').then((m) => ({ Component: m.EnrolDonePage })) },
  { path: '/enrol/booked/:id', lazy: () => import('./pages/public/Courses').then((m) => ({ Component: () => <m.EnrolDonePage booking /> })) },
  { path: '/enrol/course/:courseId', lazy: () => import('./pages/public/Courses').then((m) => ({ Component: m.BookPage })) },
  { path: '/enrol/:batchId', lazy: () => import('./pages/public/Courses').then((m) => ({ Component: m.EnrolPage })) },
  { path: '/join/trainer', lazy: () => import('./pages/TrainerSignupPage').then((m) => ({ Component: m.TrainerSignupPage })) },
  { path: '/join/employer', lazy: () => import('./pages/public/JoinPage').then((m) => ({ Component: () => <m.JoinPage type="employer" /> })) },
  { path: '/join/partner', lazy: () => import('./pages/public/JoinPage').then((m) => ({ Component: () => <m.JoinPage type="partner" /> })) },
  { path: '/login', element: <LoginPage /> },
  { path: '/forgot-password', lazy: () => import('./pages/PasswordPages').then((m) => ({ Component: m.ForgotPasswordPage })) },
  { path: '/reset-password/:token', lazy: () => import('./pages/PasswordPages').then((m) => ({ Component: m.ResetPasswordPage })) },
  { path: '/invite/:token', element: <AcceptInvitation /> },
  { path: '/choose-portal', element: <ChoosePortal /> },
  { path: '/no-access', element: <NoAccess /> },
  // Public: the page a certificate's QR code opens. No sign-in.
  { path: '/verify/:code', lazy: () => import('./pages/VerifyPage').then((m) => ({ Component: m.VerifyPage })) },
  {
    path: '/admin',
    // Admin screens load as a separate bundle, so learners on mobile never download them.
    lazy: async () => {
      const { AdminLayout } = await import('./pages/admin/AdminLayout');
      return {
        Component: () => (
          <RequirePortal portal="admin">
            <AdminLayout />
          </RequirePortal>
        ),
      };
    },
    children: [
      { index: true, lazy: () => import('./pages/admin/Dashboard').then((m) => ({ Component: m.AdminDashboard })) },
      { path: 'users', lazy: () => import('./pages/admin/Users').then((m) => ({ Component: m.UsersPage })) },
      { path: 'users/:id', lazy: () => import('./pages/admin/UserDetail').then((m) => ({ Component: m.UserDetailPage })) },
      { path: 'organisations', lazy: () => import('./pages/admin/Organisations').then((m) => ({ Component: m.OrganisationsPage })) },
      { path: 'centres', lazy: () => import('./pages/admin/Centres').then((m) => ({ Component: m.CentresPage })) },
      { path: 'audit', lazy: () => import('./pages/admin/Audit').then((m) => ({ Component: m.AuditPage })) },
      { path: 'notifications', lazy: () => import('./components/Notifications').then((m) => ({ Component: m.NotificationsPage })) },
      { path: 'account', lazy: () => import('./pages/PasswordPages').then((m) => ({ Component: m.AccountPage })) },
      { path: 'courses', lazy: () => import('./pages/training/Courses').then((m) => ({ Component: m.CoursesPage })) },
      { path: 'courses/:id', lazy: () => import('./pages/training/Courses').then((m) => ({ Component: m.CourseDetailPage })) },
      { path: 'trainers', lazy: () => import('./pages/training/Trainers').then((m) => ({ Component: m.TrainersPage })) },
      { path: 'trainers/:id', lazy: () => import('./pages/training/Trainers').then((m) => ({ Component: m.TrainerDetailPage })) },
      { path: 'candidates', lazy: () => import('./pages/training/Candidates').then((m) => ({ Component: m.CandidatesPage })) },
      { path: 'candidates/import', lazy: () => import('./pages/training/ImportCandidates').then((m) => ({ Component: m.ImportCandidatesPage })) },
      { path: 'candidates/:id', lazy: () => import('./pages/training/Candidates').then((m) => ({ Component: m.CandidateDetailPage })) },
      { path: 'batches', lazy: () => import('./pages/training/Batches').then((m) => ({ Component: () => <m.BatchesPage base="/admin/batches" /> })) },
      { path: 'batches/:id', lazy: () => import('./pages/training/Batches').then((m) => ({ Component: () => <m.BatchDetailPage base="/admin/batches" /> })) },
      { path: 'assessments', lazy: () => import('./pages/operations/ReviewQueue').then((m) => ({ Component: m.ReviewQueuePage })) },
      { path: 'credentials', lazy: () => import('./pages/operations/Credentials').then((m) => ({ Component: m.CredentialsPage })) },
      { path: 'credentials/:id', lazy: () => import('./pages/operations/Credentials').then((m) => ({ Component: m.CredentialDetailPage })) },
      { path: 'plans', lazy: () => import('./pages/admin/Plans').then((m) => ({ Component: m.PlansAdminPage })) },
      { path: 'bookings', lazy: () => import('./pages/admin/Bookings').then((m) => ({ Component: m.BookingsPage })) },
      { path: 'course-approvals', lazy: () => import('./pages/admin/CourseApprovals').then((m) => ({ Component: m.CourseApprovalsPage })) },
      { path: 'course-approvals/:id', lazy: () => import('./pages/admin/CourseApprovals').then((m) => ({ Component: m.CourseReviewPage })) },
      { path: 'jobs', lazy: () => import('./pages/admin/Hiring').then((m) => ({ Component: m.JobModerationPage })) },
      { path: 'jobs/:id', lazy: () => import('./pages/admin/Hiring').then((m) => ({ Component: m.JobModerationDetailPage })) },
      { path: 'outcomes', lazy: () => import('./pages/admin/Hiring').then((m) => ({ Component: m.HiringOutcomesPage })) },
      { path: 'programmes', lazy: () => import('./pages/programmes/Programmes').then((m) => ({ Component: () => <m.ProgrammesPage base="/admin/programmes" /> })) },
      { path: 'programmes/new', lazy: () => import('./pages/programmes/ProgrammeForm').then((m) => ({ Component: m.ProgrammeFormPage })) },
      { path: 'programmes/:id', lazy: () => import('./pages/programmes/Programmes').then((m) => ({ Component: () => <m.ProgrammeDetailPage base="/admin/programmes" /> })) },
      { path: 'programmes/:id/edit', lazy: () => import('./pages/programmes/ProgrammeForm').then((m) => ({ Component: m.ProgrammeFormPage })) },
      { path: 'reports', lazy: () => import('./pages/programmes/Reports').then((m) => ({ Component: m.ReportsPage })) },
    ],
  },
  {
    path: '/employer',
    lazy: async () => {
      const { EmployerLayout } = await import('./pages/employer/EmployerLayout');
      return {
        Component: () => (
          <RequirePortal portal="employer">
            <EmployerLayout />
          </RequirePortal>
        ),
      };
    },
    children: [
      { index: true, lazy: () => import('./pages/employer/Dashboard').then((m) => ({ Component: m.EmployerDashboard })) },
      { path: 'jobs', lazy: () => import('./pages/employer/Jobs').then((m) => ({ Component: m.EmployerJobsPage })) },
      { path: 'jobs/new', lazy: () => import('./pages/employer/Jobs').then((m) => ({ Component: m.JobFormPage })) },
      { path: 'jobs/:id', lazy: () => import('./pages/employer/Jobs').then((m) => ({ Component: m.EmployerJobDetailPage })) },
      { path: 'jobs/:id/edit', lazy: () => import('./pages/employer/Jobs').then((m) => ({ Component: m.JobFormPage })) },
      { path: 'applications/:id', lazy: () => import('./pages/employer/Application').then((m) => ({ Component: m.EmployerApplicationPage })) },
      { path: 'candidates', lazy: () => import('./pages/employer/Candidates').then((m) => ({ Component: m.CandidateSearchPage })) },
      { path: 'candidates/:id', lazy: () => import('./pages/employer/Candidates').then((m) => ({ Component: m.CandidateProfilePage })) },
      { path: 'company', lazy: () => import('./pages/employer/Company').then((m) => ({ Component: m.CompanyPage })) },
      { path: 'subscription', lazy: () => import('./pages/employer/Subscription').then((m) => ({ Component: m.SubscriptionPage })) },
      { path: 'subscription/plans', lazy: () => import('./pages/employer/Subscription').then((m) => ({ Component: m.PlansPage })) },
      { path: 'subscription/plans/:plan', lazy: () => import('./pages/employer/Subscription').then((m) => ({ Component: m.PlanDetailPage })) },
      { path: 'subscription/checkout', lazy: () => import('./pages/employer/Subscription').then((m) => ({ Component: m.CheckoutPage })) },
      { path: 'subscription/invoices/:id', lazy: () => import('./pages/employer/Subscription').then((m) => ({ Component: m.InvoicePage })) },
      { path: 'notifications', lazy: () => import('./components/Notifications').then((m) => ({ Component: m.NotificationsPage })) },
      { path: 'account', lazy: () => import('./pages/PasswordPages').then((m) => ({ Component: m.AccountPage })) },
      { path: '*', element: <NotFound /> },
    ],
  },
  // Phase 5: self-registration and the public notice pages.
  { path: '/register', lazy: () => import('./pages/RegisterPage').then((m) => ({ Component: m.RegisterPage })) },
  { path: '/privacy', lazy: () => import('./pages/public/NoticePages').then((m) => ({ Component: m.PrivacyPage })) },
  { path: '/terms', lazy: () => import('./pages/public/NoticePages').then((m) => ({ Component: m.TermsPage })) },
  {
    path: '/learn',
    lazy: async () => {
      const { LearnerLayout } = await import('./pages/learner/LearnerLayout');
      return {
        Component: () => (
          <RequirePortal portal="learn">
            <LearnerLayout />
          </RequirePortal>
        ),
      };
    },
    children: [
      { index: true, lazy: () => import('./pages/learner/Home').then((m) => ({ Component: m.LearnerHomePage })) },
      { path: 'learning', lazy: () => import('./pages/learner/Learning').then((m) => ({ Component: m.LearningPage })) },
      { path: 'learning/:id/result', lazy: () => import('./pages/learner/Learning').then((m) => ({ Component: m.ResultPage })) },
      { path: 'certificates', lazy: () => import('./pages/learner/Certificates').then((m) => ({ Component: m.WalletPage })) },
      { path: 'certificates/:id', lazy: () => import('./pages/learner/Certificates').then((m) => ({ Component: m.CertificatePage })) },
      { path: 'profile', lazy: () => import('./pages/learner/Profile').then((m) => ({ Component: m.ProfilePage })) },
      { path: 'documents', lazy: () => import('./pages/learner/Documents').then((m) => ({ Component: m.DocumentsPage })) },
      { path: 'privacy', lazy: () => import('./pages/learner/PrivacySettings').then((m) => ({ Component: m.PrivacySettingsPage })) },
      { path: 'notifications', lazy: () => import('./components/Notifications').then((m) => ({ Component: m.NotificationsPage })) },
      { path: 'account', lazy: () => import('./pages/PasswordPages').then((m) => ({ Component: m.AccountPage })) },
      { path: 'jobs', lazy: () => import('./pages/learner/Jobs').then((m) => ({ Component: m.JobsPage })) },
      { path: 'jobs/:id', lazy: () => import('./pages/learner/Jobs').then((m) => ({ Component: m.JobDetailPage })) },
      { path: 'applications', lazy: () => import('./pages/learner/Jobs').then((m) => ({ Component: m.ApplicationsPage })) },
      { path: 'applications/:id', lazy: () => import('./pages/learner/Jobs').then((m) => ({ Component: m.ApplicationDetailPage })) },
      { path: '*', element: <NotFound /> },
    ],
  },
  {
    path: '/partner',
    element: (
      <RequirePortal portal="partner">
        <PartnerLayout />
      </RequirePortal>
    ),
    children: [
      // Training partners get the course dashboard (wireframe screen 1); trainers keep their Today screen.
      { index: true, lazy: () => import('./pages/partner/Home').then((m) => ({ Component: m.PartnerHome })) },
      { path: 'courses', lazy: () => import('./pages/partner/Courses').then((m) => ({ Component: m.PartnerCoursesPage })) },
      { path: 'courses/new', lazy: () => import('./pages/partner/Courses').then((m) => ({ Component: m.CourseWizardPage })) },
      { path: 'courses/:id', lazy: () => import('./pages/partner/Courses').then((m) => ({ Component: m.PartnerCourseDetailPage })) },
      { path: 'courses/:id/edit', lazy: () => import('./pages/partner/Courses').then((m) => ({ Component: m.CourseWizardPage })) },
      { path: 'batches', lazy: () => import('./pages/training/Batches').then((m) => ({ Component: () => <m.BatchesPage base="/partner/batches" /> })) },
      { path: 'batches/:id', lazy: () => import('./pages/training/Batches').then((m) => ({ Component: () => <m.BatchDetailPage base="/partner/batches" /> })) },
      // Phase 7: programmes and the partner's organisation.
      { path: 'programmes', lazy: () => import('./pages/programmes/Programmes').then((m) => ({ Component: () => <m.ProgrammesPage base="/partner/programmes" /> })) },
      { path: 'programmes/:id', lazy: () => import('./pages/programmes/Programmes').then((m) => ({ Component: () => <m.ProgrammeDetailPage base="/partner/programmes" /> })) },
      { path: 'organisation', lazy: () => import('./pages/programmes/Reports').then((m) => ({ Component: m.PartnerOrganisationPage })) },
      { path: 'trainers', lazy: () => import('./pages/training/Trainers').then((m) => ({ Component: () => <m.TrainersPage base="/partner/trainers" /> })) },
      { path: 'trainers/:id', lazy: () => import('./pages/training/Trainers').then((m) => ({ Component: () => <m.TrainerDetailPage base="/partner/trainers" /> })) },
      // Phase 4: trainer screens that work offline.
      { path: 'attendance/:id', lazy: () => import('./pages/trainer/TakeAttendance').then((m) => ({ Component: m.TakeAttendancePage })) },
      { path: 'sync', lazy: () => import('./pages/trainer/SyncStatus').then((m) => ({ Component: m.SyncStatusPage })) },
      { path: 'notifications', lazy: () => import('./components/Notifications').then((m) => ({ Component: m.NotificationsPage })) },
      { path: 'account', lazy: () => import('./pages/PasswordPages').then((m) => ({ Component: m.AccountPage })) },
      { path: '*', element: <NotFound /> },
    ],
  },
  { path: '*', element: <NotFound /> },
]);

// The staging banner takes 30px; one-screen pages (home, sign-in) subtract it so they still fit the window.
if (import.meta.env.VITE_APP_ENV === 'staging') document.documentElement.style.setProperty('--banner-h', '30px');

/** A new language re-renders every screen (the address and loaded data stay). */
function Translated() {
  const lang = useSyncExternalStore(onLangChange, currentLang);
  return <RouterProvider key={lang} router={router} />;
}

void initI18n().then(() => createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <ToastProvider>
          {import.meta.env.VITE_APP_ENV === 'staging' && (
            <p role="note" className="flex h-[30px] items-center justify-center truncate bg-ink px-4 text-center text-[12px] font-medium text-white">
              Staging copy with demo data. Do not enter real personal information.
            </p>
          )}
          <Translated />
          <UpdatePrompt />
        </ToastProvider>
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>,
));
