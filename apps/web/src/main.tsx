import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router';
import { ToastProvider } from './components/toast';
import { UpdatePrompt } from './components/UpdatePrompt';
import { AuthProvider } from './lib/auth';
import { AcceptInvitation, ChoosePortal, HomeRedirect, NoAccess, NotFound, RequirePortal } from './pages/AccessPages';
import { LoginPage } from './pages/LoginPage';
import { PartnerLayout, PortalHomeContent } from './pages/PortalHomes';
import './styles.css';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

const router = createBrowserRouter([
  { path: '/', element: <HomeRedirect /> },
  { path: '/login', element: <LoginPage /> },
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
      { path: 'team', lazy: () => import('./pages/employer/Company').then((m) => ({ Component: m.TeamPage })) },
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
      { index: true, element: <PortalHomeContent portal="partner" /> },
      { path: 'batches', lazy: () => import('./pages/training/Batches').then((m) => ({ Component: () => <m.BatchesPage base="/partner/batches" /> })) },
      { path: 'batches/:id', lazy: () => import('./pages/training/Batches').then((m) => ({ Component: () => <m.BatchDetailPage base="/partner/batches" /> })) },
      // Phase 7: programmes and the partner's organisation.
      { path: 'programmes', lazy: () => import('./pages/programmes/Programmes').then((m) => ({ Component: () => <m.ProgrammesPage base="/partner/programmes" /> })) },
      { path: 'programmes/:id', lazy: () => import('./pages/programmes/Programmes').then((m) => ({ Component: () => <m.ProgrammeDetailPage base="/partner/programmes" /> })) },
      { path: 'organisation', lazy: () => import('./pages/programmes/Reports').then((m) => ({ Component: m.PartnerOrganisationPage })) },
      // Phase 4: trainer screens that work offline.
      { path: 'attendance/:id', lazy: () => import('./pages/trainer/TakeAttendance').then((m) => ({ Component: m.TakeAttendancePage })) },
      { path: 'sync', lazy: () => import('./pages/trainer/SyncStatus').then((m) => ({ Component: m.SyncStatusPage })) },
      { path: '*', element: <NotFound /> },
    ],
  },
  { path: '*', element: <NotFound /> },
]);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <ToastProvider>
          <RouterProvider router={router} />
          <UpdatePrompt />
        </ToastProvider>
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>,
);
