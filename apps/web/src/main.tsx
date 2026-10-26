import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router';
import { ToastProvider } from './components/toast';
import { AuthProvider } from './lib/auth';
import { AcceptInvitation, ChoosePortal, HomeRedirect, NoAccess, NotFound, RequirePortal } from './pages/AccessPages';
import { LoginPage } from './pages/LoginPage';
import { PartnerLayout, PortalHome, PortalHomeContent } from './pages/PortalHomes';
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
    ],
  },
  { path: '/employer/*', element: <RequirePortal portal="employer"><PortalHome portal="employer" /></RequirePortal> },
  { path: '/learn/*', element: <RequirePortal portal="learn"><PortalHome portal="learn" /></RequirePortal> },
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
        </ToastProvider>
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>,
);
