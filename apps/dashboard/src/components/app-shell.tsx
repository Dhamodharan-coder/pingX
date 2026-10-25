import { Button, buttonVariants } from '@/components/ui/button';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/utils';
import { useQuery } from '@tanstack/react-query';
import {
  ActivityIcon,
  BarChart3Icon,
  BookOpenIcon,
  CreditCardIcon,
  FileTextIcon,
  FolderIcon,
  GaugeIcon,
  InboxIcon,
  LayoutDashboardIcon,
  LogOutIcon,
  MailIcon,
  MenuIcon,
  ScrollTextIcon,
  ServerIcon,
  SettingsIcon,
  ShieldIcon,
  UsersIcon,
  type LucideIcon,
} from 'lucide-react';
import { useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { toast } from 'sonner';

const userNav: [string, string, LucideIcon][] = [
  ['/', 'Overview', LayoutDashboardIcon],
  ['/projects', 'Projects', FolderIcon],
  ['/providers', 'Providers', ServerIcon],
  ['/templates', 'Templates', FileTextIcon],
  ['/messages', 'Messages', InboxIcon],
  ['/usage', 'Usage', BarChart3Icon],
  ['/billing', 'Billing', CreditCardIcon],
  ['/docs', 'Quickstart', BookOpenIcon],
  ['/settings', 'Settings', SettingsIcon],
];

const adminNav: [string, string, LucideIcon][] = [
  ['/admin', 'Admin overview', GaugeIcon],
  ['/admin/users', 'Users', UsersIcon],
  ['/admin/plans', 'Plans', CreditCardIcon],
  ['/admin/subscriptions', 'Subscriptions', ActivityIcon],
  ['/admin/providers', 'Providers', ServerIcon],
  ['/admin/presets', 'Presets', SettingsIcon],
  ['/admin/templates', 'Templates', FileTextIcon],
  ['/admin/messages', 'Messages', MailIcon],
  ['/admin/settings', 'Settings', SettingsIcon],
  ['/admin/audit', 'Audit log', ScrollTextIcon],
];

function NavList({ items, onNavigate }: { items: [string, string, LucideIcon][]; onNavigate: () => void }) {
  return (
    <nav className="grid gap-0.5">
      {items.map(([to, label, Icon]) => (
        <NavLink
          key={to}
          to={to}
          end={to === '/' || to === '/admin'}
          onClick={onNavigate}
          className={({ isActive }) =>
            cn(
              'flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
              isActive && 'bg-muted font-medium text-foreground',
            )
          }
        >
          <Icon className="size-4" />
          {label}
        </NavLink>
      ))}
    </nav>
  );
}

function VerifyBanner() {
  const [sent, setSent] = useState(false);
  return (
    <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b bg-amber-500/10 px-6 py-2 text-sm text-amber-800 dark:text-amber-300">
      <span>Verify your email to start sending. Check your inbox for the link.</span>
      <Button
        size="xs"
        variant="outline"
        disabled={sent}
        onClick={() =>
          api
            .post('/auth/resend-verification')
            .then(() => {
              setSent(true);
              toast.success('Verification email sent');
            })
            .catch((e) => toast.error(errorMessage(e)))
        }
      >
        {sent ? 'Sent' : 'Resend email'}
      </Button>
    </div>
  );
}

export function AppShell() {
  const { user, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();
  const isAdminArea = pathname.startsWith('/admin');
  // Full-screen tools (the template editor) manage their own scrolling and use the whole content area.
  const fullBleed = /^\/templates\/[^/]+$/.test(pathname);
  const { data: publicSettings } = useQuery({
    queryKey: ['settings-public'],
    queryFn: () => api.get<{ banner: string | null }>('/settings/public'),
    staleTime: 60_000,
  });

  const sidebar = (
    <div className="flex h-full flex-col gap-6 p-4">
      <Link to="/" className="flex items-center gap-2 px-2 font-semibold" onClick={() => setOpen(false)}>
        <span className="grid size-7 place-items-center rounded-lg bg-primary text-primary-foreground">
          <MailIcon className="size-4" />
        </span>
        PingX
      </Link>
      <NavList items={isAdminArea ? adminNav : userNav} onNavigate={() => setOpen(false)} />
      <div className="mt-auto grid gap-2">
        {user?.role === 'admin' && (
          <Link to={isAdminArea ? '/' : '/admin'} className={buttonVariants({ variant: 'outline', size: 'sm' })} onClick={() => setOpen(false)}>
            <ShieldIcon />
            {isAdminArea ? 'Back to app' : 'Admin panel'}
          </Link>
        )}
        <div className="rounded-lg border p-2.5 text-xs">
          <p className="truncate font-medium">{user?.email}</p>
          <p className="text-muted-foreground">{user?.plan.name} plan</p>
        </div>
        <Button variant="ghost" size="sm" className="justify-start" onClick={() => void signOut()}>
          <LogOutIcon />
          Sign out
        </Button>
      </div>
    </div>
  );

  return (
    <div className="h-dvh bg-background md:grid md:grid-cols-[232px_1fr]">
      <aside className="hidden h-dvh overflow-y-auto border-r bg-sidebar md:block">{sidebar}</aside>
      {open && (
        <div className="fixed inset-0 z-40 md:hidden" onClick={() => setOpen(false)}>
          <div className="absolute inset-0 bg-black/30" />
          <aside className="absolute inset-y-0 left-0 w-64 border-r bg-sidebar" onClick={(e) => e.stopPropagation()}>
            {sidebar}
          </aside>
        </div>
      )}
      <div className="flex h-dvh min-w-0 flex-col">
        <header className="flex shrink-0 items-center gap-2 border-b px-4 py-2 md:hidden">
          <Button variant="ghost" size="icon" onClick={() => setOpen(true)} aria-label="Open menu">
            <MenuIcon />
          </Button>
          <span className="font-semibold">PingX</span>
        </header>
        {publicSettings?.banner && <div className="shrink-0 border-b bg-blue-500/10 px-6 py-2 text-sm">{publicSettings.banner}</div>}
        {user && !user.emailVerified && <VerifyBanner />}
        {fullBleed ? (
          <main className="min-h-0 flex-1">
            <Outlet />
          </main>
        ) : (
          <main className="min-h-0 flex-1 overflow-y-auto">
            <div className="mx-auto max-w-6xl p-4 md:p-8">
              <Outlet />
            </div>
          </main>
        )}
      </div>
    </div>
  );
}
