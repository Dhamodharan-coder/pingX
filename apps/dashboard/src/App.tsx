import { AppShell } from '@/components/app-shell';
import { Loading } from '@/components/common';
import { useAuth } from '@/lib/auth';
import {
  ForgotPasswordPage,
  LoginPage,
  ResetPasswordPage,
  SignupPage,
  VerifyEmailPage,
} from '@/pages/auth';
import { BillingPage } from '@/pages/billing';
import { DocsPage } from '@/pages/docs';
import { MessageDetailPage, MessagesPage } from '@/pages/messages';
import { OverviewPage } from '@/pages/overview';
import { ProjectDetailPage, ProjectsPage } from '@/pages/projects';
import { ProvidersPage } from '@/pages/providers';
import { SettingsPage } from '@/pages/settings';
import { TemplatesPage } from '@/pages/templates';
import { UsagePage } from '@/pages/usage';
import { lazy, Suspense, type ComponentType, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';

const admin = () => import('@/pages/admin');
const lazyNamed = <M,>(load: () => Promise<M>, name: keyof M) =>
  lazy(async () => ({ default: (await load())[name] as ComponentType }));

const AdminAuditPage = lazyNamed(admin, 'AdminAuditPage');
const AdminMessageDetailPage = lazyNamed(admin, 'AdminMessageDetailPage');
const AdminMessagesPage = lazyNamed(admin, 'AdminMessagesPage');
const AdminOverviewPage = lazyNamed(admin, 'AdminOverviewPage');
const AdminPlansPage = lazyNamed(admin, 'AdminPlansPage');
const AdminPresetsPage = lazyNamed(admin, 'AdminPresetsPage');
const AdminProvidersPage = lazyNamed(admin, 'AdminProvidersPage');
const AdminSettingsPage = lazyNamed(admin, 'AdminSettingsPage');
const AdminSubscriptionsPage = lazyNamed(admin, 'AdminSubscriptionsPage');
const AdminTemplatesPage = lazyNamed(admin, 'AdminTemplatesPage');
const AdminUserDetailPage = lazyNamed(admin, 'AdminUserDetailPage');
const AdminUsersPage = lazyNamed(admin, 'AdminUsersPage');
const TemplateEditorPage = lazyNamed(() => import('@/pages/template-editor'), 'TemplateEditorPage');

function RequireAuth({ children, admin }: { children: ReactNode; admin?: boolean }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <Loading className="h-screen" />;
  if (!user) return <Navigate to="/login" replace state={{ from: location }} />;
  if (admin && user.role !== 'admin') return <Navigate to="/" replace />;
  return children;
}

export function App() {
  const { loading } = useAuth();
  if (loading) return <Loading className="h-screen" />;
  return (
    <Suspense fallback={<Loading className="h-screen" />}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/signup" element={<SignupPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/verify-email" element={<VerifyEmailPage />} />
        <Route
          element={
            <RequireAuth>
              <AppShell />
            </RequireAuth>
          }
        >
          <Route index element={<OverviewPage />} />
          <Route path="projects" element={<ProjectsPage />} />
          <Route path="projects/:id" element={<ProjectDetailPage />} />
          <Route path="providers" element={<ProvidersPage />} />
          <Route path="templates" element={<TemplatesPage />} />
          <Route path="templates/:id" element={<TemplateEditorPage />} />
          <Route path="messages" element={<MessagesPage />} />
          <Route path="messages/:id" element={<MessageDetailPage />} />
          <Route path="usage" element={<UsagePage />} />
          <Route path="billing" element={<BillingPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="docs" element={<DocsPage />} />
        </Route>
        <Route
          path="admin"
          element={
            <RequireAuth admin>
              <AppShell />
            </RequireAuth>
          }
        >
          <Route index element={<AdminOverviewPage />} />
          <Route path="users" element={<AdminUsersPage />} />
          <Route path="users/:id" element={<AdminUserDetailPage />} />
          <Route path="plans" element={<AdminPlansPage />} />
          <Route path="subscriptions" element={<AdminSubscriptionsPage />} />
          <Route path="providers" element={<AdminProvidersPage />} />
          <Route path="presets" element={<AdminPresetsPage />} />
          <Route path="templates" element={<AdminTemplatesPage />} />
          <Route path="messages" element={<AdminMessagesPage />} />
          <Route path="messages/:id" element={<AdminMessageDetailPage />} />
          <Route path="settings" element={<AdminSettingsPage />} />
          <Route path="audit" element={<AdminAuditPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
