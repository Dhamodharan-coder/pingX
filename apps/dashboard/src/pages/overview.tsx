import { ErrorNote, Loading, PageHeader, StatusBadge } from '@/components/common';
import { QuotaTile, StatTile } from '@/components/usage-chart';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { fmtDate } from '@/lib/format';
import type { Page, MessageRow, Project, Provider } from '@/lib/types';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2Icon, CircleIcon } from 'lucide-react';
import { Link } from 'react-router-dom';

export function OverviewPage() {
  const { user } = useAuth();
  const providers = useQuery({ queryKey: ['providers'], queryFn: () => api.get<Provider[]>('/providers') });
  const projects = useQuery({ queryKey: ['projects'], queryFn: () => api.get<Project[]>('/projects') });
  const recent = useQuery({ queryKey: ['messages', 'recent'], queryFn: () => api.get<Page<MessageRow>>('/messages?limit=8') });

  if (!user) return null;
  if (providers.isLoading || projects.isLoading) return <Loading />;
  if (providers.error) return <ErrorNote error={providers.error} />;

  const steps = [
    { done: user.emailVerified, label: 'Verify your email', to: '/settings' },
    { done: (providers.data?.length ?? 0) > 0, label: 'Connect an email provider', to: '/providers' },
    { done: (projects.data?.length ?? 0) > 0, label: 'Create a project', to: '/projects' },
    { done: (projects.data ?? []).some((p) => (p._count?.apiKeys ?? 0) > 0), label: 'Create an API key', to: '/projects' },
    { done: (recent.data?.items.length ?? 0) > 0, label: 'Send your first email', to: '/docs' },
  ];
  const remaining = steps.filter((s) => !s.done).length;

  return (
    <>
      <PageHeader title={`Hi${user.name ? `, ${user.name}` : ''}`} description="Here is what's happening with your email today." />
      <div className="grid gap-4 sm:grid-cols-3">
        <QuotaTile label="Sent today" used={user.usage.day} limit={user.limits.daily} />
        <QuotaTile label="This month" used={user.usage.month} limit={user.limits.monthly} />
        <StatTile label="Healthy providers" value={`${providers.data?.filter((p) => p.healthy).length ?? 0} / ${providers.data?.length ?? 0}`} />
      </div>

      {remaining > 0 && (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle>Get started</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2">
            {steps.map((s) => (
              <Link key={s.label} to={s.to} className="flex items-center gap-2 text-sm hover:underline">
                {s.done ? <CheckCircle2Icon className="size-4 text-emerald-600" /> : <CircleIcon className="size-4 text-muted-foreground" />}
                <span className={s.done ? 'text-muted-foreground line-through' : ''}>{s.label}</span>
              </Link>
            ))}
          </CardContent>
        </Card>
      )}

      <Card className="mt-6">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Recent messages</CardTitle>
          <Link to="/messages" className={buttonVariants({ variant: 'outline', size: 'sm' })}>View all</Link>
        </CardHeader>
        <CardContent>
          {recent.data?.items.length ? (
            <div className="divide-y">
              {recent.data.items.map((m) => (
                <Link key={m.id} to={`/messages/${m.id}`} className="flex items-center justify-between gap-4 py-2.5 text-sm hover:bg-muted/50">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{m.subject}</p>
                    <p className="truncate text-muted-foreground">{m.to.join(', ')}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <span className="hidden text-xs text-muted-foreground sm:inline">{fmtDate(m.createdAt)}</span>
                    <StatusBadge status={m.status} />
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No messages yet.</p>
          )}
        </CardContent>
      </Card>
    </>
  );
}
