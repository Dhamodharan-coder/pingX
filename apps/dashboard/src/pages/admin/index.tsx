import { ErrorNote, Field, Loading, NativeSelect, PageHeader } from '@/components/common';
import { StatTile, UsageChart } from '@/components/usage-chart';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { MessageDetailView, MessageTable } from '@/pages/messages';
import { api, errorMessage } from '@/lib/api';
import { fmtDate, fmtNum, providerLabel } from '@/lib/format';
import type { Plan, Preset, ProviderType, Template, UsageSeries } from '@/lib/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PlusIcon } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';

function useAdminMutation<T>(fn: (v: T) => Promise<unknown>, invalidate: string[], success = 'Saved') {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      invalidate.forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      toast.success(success);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
}

export function AdminOverviewPage() {
  const stats = useQuery({ queryKey: ['admin-stats'], queryFn: () => api.get<Record<string, number>>('/admin/stats'), refetchInterval: 15_000 });
  const usage = useQuery({ queryKey: ['admin-usage'], queryFn: () => api.get<{ series: UsageSeries[]; topUsers: { userId: string; email: string; sent: number }[] }>('/admin/usage?days=30') });
  if (stats.isLoading) return <Loading />;
  if (stats.error) return <ErrorNote error={stats.error} />;
  const s = stats.data!;
  return (
    <>
      <PageHeader title="Admin overview" description="Platform-wide health. Admins can never read user credentials." />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Users" value={fmtNum(s.users ?? 0)} hint={`${s.newUsers} new today`} />
        <StatTile label="Sent today" value={fmtNum(s.sentToday ?? 0)} hint={`${s.failedToday} failed`} />
        <StatTile label="In queue" value={fmtNum(s.queued ?? 0)} />
        <StatTile label="Active subscriptions" value={fmtNum(s.activeSubs ?? 0)} hint={`${s.unhealthyProviders} unhealthy providers`} />
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_320px]">
        <Card>
          <CardHeader><CardTitle>Platform volume (30 days)</CardTitle></CardHeader>
          <CardContent>{usage.data && <UsageChart series={fillDays(usage.data.series, 30)} />}</CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Top senders</CardTitle></CardHeader>
          <CardContent className="grid gap-2 text-sm">
            {usage.data?.topUsers.map((u) => (
              <Link key={u.userId} to={`/admin/users/${u.userId}`} className="flex justify-between hover:underline">
                <span className="truncate">{u.email}</span>
                <span className="tabular-nums text-muted-foreground">{fmtNum(u.sent)}</span>
              </Link>
            ))}
            {!usage.data?.topUsers.length && <p className="text-muted-foreground">No sends yet.</p>}
          </CardContent>
        </Card>
      </div>
    </>
  );
}

function fillDays(series: UsageSeries[], days: number): UsageSeries[] {
  const map = new Map(series.map((s) => [s.date, s]));
  return Array.from({ length: days }, (_, i) => {
    const date = new Date(Date.now() - (days - 1 - i) * 86_400_000).toISOString().slice(0, 10);
    return map.get(date) ?? { date, sent: 0, failed: 0 };
  });
}

interface AdminUserRow {
  id: string;
  email: string;
  name: string | null;
  role: 'user' | 'admin';
  emailVerifiedAt: string | null;
  disabledAt: string | null;
  dailyLimitOverride: number | null;
  createdAt: string;
  plan: { id: string; code: string; name: string };
}

export function AdminUsersPage() {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const { data, isLoading, error } = useQuery({
    queryKey: ['admin-users', search, page],
    queryFn: () => api.get<{ items: AdminUserRow[]; total: number; pageSize: number }>(`/admin/users?page=${page}${search ? `&q=${encodeURIComponent(search)}` : ''}`),
  });
  return (
    <>
      <PageHeader title="Users" description={data ? `${fmtNum(data.total)} accounts` : undefined} />
      <form className="mb-4 flex gap-2" onSubmit={(e) => { e.preventDefault(); setPage(1); setSearch(q); }}>
        <Input className="w-72" placeholder="Search email or name" value={q} onChange={(e) => setQ(e.target.value)} />
        <Button variant="outline" type="submit">Search</Button>
      </form>
      {isLoading ? <Loading /> : error ? <ErrorNote error={error} /> : (
        <Card>
          <Table>
            <TableHeader><TableRow><TableHead>Email</TableHead><TableHead>Plan</TableHead><TableHead>Status</TableHead><TableHead>Joined</TableHead></TableRow></TableHeader>
            <TableBody>
              {data!.items.map((u) => (
                <TableRow key={u.id} className="cursor-pointer" onClick={() => navigate(`/admin/users/${u.id}`)}>
                  <TableCell>{u.email}{u.role === 'admin' && <Badge className="ml-2">admin</Badge>}</TableCell>
                  <TableCell>{u.plan.name}{u.dailyLimitOverride !== null && <span className="text-muted-foreground"> · {u.dailyLimitOverride}/day</span>}</TableCell>
                  <TableCell>{u.disabledAt ? <Badge variant="destructive">Disabled</Badge> : u.emailVerifiedAt ? <Badge variant="outline">Verified</Badge> : <Badge variant="secondary">Unverified</Badge>}</TableCell>
                  <TableCell className="text-muted-foreground">{fmtDate(u.createdAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
      {data && data.total > data.pageSize && (
        <div className="mt-4 flex justify-center gap-2">
          <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage(page - 1)}>Previous</Button>
          <Button variant="outline" size="sm" disabled={page * data.pageSize >= data.total} onClick={() => setPage(page + 1)}>Next</Button>
        </div>
      )}
    </>
  );
}

interface AdminUserDetail extends AdminUserRow {
  today: number;
  plan: Plan & { id: string; code: string; name: string };
  projects: { id: string; name: string }[];
  providers: { id: string; name: string; type: ProviderType; priority: number; fromEmail: string; healthy: boolean; lastError: string | null }[];
  subscriptions: { id: string; status: string; razorpaySubscriptionId: string; plan: { name: string }; createdAt: string }[];
  usage: { date: string; sent: number; failed: number }[];
}

export function AdminUserDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data: u, isLoading, error } = useQuery({ queryKey: ['admin-user', id], queryFn: () => api.get<AdminUserDetail>(`/admin/users/${id}`) });
  const plans = useQuery({ queryKey: ['admin-plans'], queryFn: () => api.get<Plan[]>('/admin/plans') });
  const [override, setOverride] = useState<string>();
  const update = useAdminMutation((body: Record<string, unknown>) => api.patch(`/admin/users/${id}`, body), ['admin-user', 'admin-users']);
  if (isLoading) return <Loading />;
  if (error || !u) return <ErrorNote error={error} />;
  return (
    <>
      <Link to="/admin/users" className="mb-4 inline-block text-sm text-muted-foreground hover:text-foreground">← Users</Link>
      <PageHeader title={u.email} description={`${u.name ?? 'No name'} · joined ${fmtDate(u.createdAt)} · ${u.today} sent today`} />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Account</CardTitle></CardHeader>
          <CardContent className="grid gap-4">
            <Field label="Plan">
              <NativeSelect value={u.plan.id} onChange={(e) => update.mutate({ planId: e.target.value })}>
                {plans.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </NativeSelect>
            </Field>
            <Field label="Daily limit override" hint={`Plan default: ${u.plan.dailyLimit}. Leave empty to use the plan.`}>
              <div className="flex gap-2">
                <Input type="number" min={0} value={override ?? (u.dailyLimitOverride ?? '')} onChange={(e) => setOverride(e.target.value)} />
                <Button variant="outline" onClick={() => update.mutate({ dailyLimitOverride: override === '' || override === undefined ? null : Number(override) })}>Save</Button>
              </div>
            </Field>
            <div className="flex items-center justify-between text-sm">
              <span>Admin role</span>
              <Switch checked={u.role === 'admin'} onCheckedChange={(v) => update.mutate({ role: v ? 'admin' : 'user' })} />
            </div>
            <div className="flex items-center justify-between text-sm">
              <span>Email verified</span>
              <Switch checked={!!u.emailVerifiedAt} onCheckedChange={(v) => update.mutate({ emailVerified: v })} />
            </div>
            <div className="flex items-center justify-between text-sm">
              <span>Disabled (blocks login and API keys)</span>
              <Switch checked={!!u.disabledAt} onCheckedChange={(v) => update.mutate({ disabled: v })} />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Providers</CardTitle></CardHeader>
          <CardContent className="grid gap-2 text-sm">
            <p className="text-xs text-muted-foreground">Credentials are encrypted and not visible to admins.</p>
            {u.providers.map((p) => (
              <div key={p.id} className="flex items-center justify-between gap-2 rounded-lg border p-2">
                <span className="truncate">{p.priority}. {p.name} · {providerLabel[p.type]} · {p.fromEmail}</span>
                {p.healthy ? <Badge variant="outline">healthy</Badge> : <Badge variant="destructive">disabled</Badge>}
              </div>
            ))}
            {!u.providers.length && <p className="text-muted-foreground">None</p>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Subscriptions</CardTitle></CardHeader>
          <CardContent className="grid gap-2 text-sm">
            {u.subscriptions.map((s) => <p key={s.id}>{s.plan.name} · <span className="capitalize">{s.status}</span> · {fmtDate(s.createdAt)}</p>)}
            {!u.subscriptions.length && <p className="text-muted-foreground">None</p>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Recent usage</CardTitle></CardHeader>
          <CardContent className="grid gap-1 text-sm">
            {u.usage.map((d) => <p key={d.date} className="flex justify-between"><span>{d.date.slice(0, 10)}</span><span className="tabular-nums">{d.sent} sent · {d.failed} failed</span></p>)}
            {!u.usage.length && <p className="text-muted-foreground">No sends yet</p>}
          </CardContent>
        </Card>
      </div>
    </>
  );
}

const emptyPlan = { code: '', name: '', dailyLimit: 100, monthlyLimit: 3000, burstPerSecond: 5, aiDailyLimit: 5, priceInr: 0, razorpayPlanId: '', active: true, sortOrder: 10 };

export function AdminPlansPage() {
  const plans = useQuery({ queryKey: ['admin-plans'], queryFn: () => api.get<Plan[]>('/admin/plans') });
  const [editing, setEditing] = useState<(typeof emptyPlan & { id?: string }) | null>(null);
  const save = useAdminMutation(
    (p: typeof emptyPlan & { id?: string }) => {
      const { id, ...body } = p;
      const payload = { ...body, razorpayPlanId: body.razorpayPlanId || null };
      return id ? api.patch(`/admin/plans/${id}`, payload) : api.post('/admin/plans', payload);
    },
    ['admin-plans', 'plans'],
  );
  const num = (k: keyof typeof emptyPlan) => (
    <Field label={k}><Input type="number" value={String(editing?.[k] ?? '')} onChange={(e) => setEditing((p) => (p ? { ...p, [k]: Number(e.target.value) } : p))} /></Field>
  );
  return (
    <>
      <PageHeader title="Plans" description="Limits and prices are read from here (cached 60s). Nothing is hard-coded." actions={<Button onClick={() => setEditing({ ...emptyPlan })}><PlusIcon />New plan</Button>} />
      {plans.isLoading ? <Loading /> : (
        <Card>
          <Table>
            <TableHeader><TableRow><TableHead>Plan</TableHead><TableHead>Daily</TableHead><TableHead>Monthly</TableHead><TableHead>Burst/s</TableHead><TableHead>AI/day</TableHead><TableHead>Price</TableHead><TableHead>Users</TableHead><TableHead /></TableRow></TableHeader>
            <TableBody>
              {plans.data?.map((p) => (
                <TableRow key={p.id}>
                  <TableCell>{p.name} <span className="font-mono text-xs text-muted-foreground">{p.code}</span>{!p.active && <Badge variant="secondary" className="ml-2">inactive</Badge>}</TableCell>
                  <TableCell className="tabular-nums">{fmtNum(p.dailyLimit)}</TableCell>
                  <TableCell className="tabular-nums">{fmtNum(p.monthlyLimit)}</TableCell>
                  <TableCell className="tabular-nums">{p.burstPerSecond}</TableCell>
                  <TableCell className="tabular-nums">{p.aiDailyLimit}</TableCell>
                  <TableCell>₹{p.priceInr}</TableCell>
                  <TableCell>{p._count?.users}</TableCell>
                  <TableCell><Button size="xs" variant="outline" onClick={() => setEditing({ ...emptyPlan, ...p, razorpayPlanId: p.razorpayPlanId ?? '', active: p.active ?? true, sortOrder: p.sortOrder ?? 0 })}>Edit</Button></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
      <Dialog open={!!editing} onOpenChange={() => setEditing(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing?.id ? `Edit ${editing.name}` : 'New plan'}</DialogTitle></DialogHeader>
          {editing && (
            <form className="grid gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); save.mutate(editing, { onSuccess: () => setEditing(null) }); }}>
              <Field label="code"><Input required value={editing.code} onChange={(e) => setEditing({ ...editing, code: e.target.value })} /></Field>
              <Field label="name"><Input required value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></Field>
              {num('dailyLimit')}{num('monthlyLimit')}{num('burstPerSecond')}{num('aiDailyLimit')}{num('priceInr')}{num('sortOrder')}
              <Field label="Razorpay plan id" className="sm:col-span-2"><Input value={editing.razorpayPlanId ?? ''} onChange={(e) => setEditing({ ...editing, razorpayPlanId: e.target.value })} placeholder="plan_..." /></Field>
              <div className="flex items-center gap-2 text-sm"><Switch checked={editing.active} onCheckedChange={(v) => setEditing({ ...editing, active: v })} />Active</div>
              <DialogFooter className="sm:col-span-2"><Button type="submit" disabled={save.isPending}>Save</Button></DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

export function AdminSubscriptionsPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['admin-subs'],
    queryFn: () => api.get<{ id: string; status: string; razorpaySubscriptionId: string; currentPeriodEnd: string | null; createdAt: string; user: { email: string }; plan: { name: string; priceInr: number } }[]>('/admin/subscriptions'),
  });
  return (
    <>
      <PageHeader title="Subscriptions" />
      {isLoading ? <Loading /> : (
        <Card>
          <Table>
            <TableHeader><TableRow><TableHead>User</TableHead><TableHead>Plan</TableHead><TableHead>Status</TableHead><TableHead>Razorpay id</TableHead><TableHead>Period end</TableHead></TableRow></TableHeader>
            <TableBody>
              {data?.map((s) => (
                <TableRow key={s.id}>
                  <TableCell>{s.user.email}</TableCell>
                  <TableCell>{s.plan.name} · ₹{s.plan.priceInr}</TableCell>
                  <TableCell className="capitalize">{s.status}</TableCell>
                  <TableCell className="font-mono text-xs">{s.razorpaySubscriptionId}</TableCell>
                  <TableCell>{fmtDate(s.currentPeriodEnd)}</TableCell>
                </TableRow>
              ))}
              {!data?.length && <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">No subscriptions yet</TableCell></TableRow>}
            </TableBody>
          </Table>
        </Card>
      )}
    </>
  );
}

export function AdminProvidersPage() {
  const [unhealthy, setUnhealthy] = useState(false);
  const { data, isLoading } = useQuery({
    queryKey: ['admin-providers', unhealthy],
    queryFn: () => api.get<{ id: string; name: string; type: ProviderType; fromEmail: string; healthy: boolean; lastError: string | null; lastUsedAt: string | null; user: { email: string }; userId: string }[]>(`/admin/providers${unhealthy ? '?unhealthy=true' : ''}`),
  });
  return (
    <>
      <PageHeader title="Providers" description="Connection metadata only — credentials are encrypted and never readable here." actions={<label className="flex items-center gap-2 text-sm"><Switch checked={unhealthy} onCheckedChange={setUnhealthy} />Only unhealthy</label>} />
      {isLoading ? <Loading /> : (
        <Card>
          <Table>
            <TableHeader><TableRow><TableHead>User</TableHead><TableHead>Provider</TableHead><TableHead>From</TableHead><TableHead>Health</TableHead><TableHead>Last used</TableHead></TableRow></TableHeader>
            <TableBody>
              {data?.map((p) => (
                <TableRow key={p.id}>
                  <TableCell><Link className="hover:underline" to={`/admin/users/${p.userId}`}>{p.user.email}</Link></TableCell>
                  <TableCell>{p.name} · {providerLabel[p.type]}</TableCell>
                  <TableCell>{p.fromEmail}</TableCell>
                  <TableCell title={p.lastError ?? ''}>{p.healthy ? <Badge variant="outline">healthy</Badge> : <Badge variant="destructive">disabled</Badge>}</TableCell>
                  <TableCell className="text-muted-foreground">{fmtDate(p.lastUsedAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </>
  );
}

const emptyPreset: Omit<Preset, 'id'> & { id?: string } = { name: '', type: 'smtp', host: '', port: 465, secure: true, dailyCap: null, helpUrl: '', notes: '', active: true, sortOrder: 10 };

export function AdminPresetsPage() {
  const { data, isLoading } = useQuery({ queryKey: ['admin-presets'], queryFn: () => api.get<Preset[]>('/admin/presets') });
  const [editing, setEditing] = useState<typeof emptyPreset | null>(null);
  const save = useAdminMutation(
    (p: typeof emptyPreset) => {
      const { id, ...body } = p;
      const payload = { ...body, host: body.host || null, helpUrl: body.helpUrl || null, notes: body.notes || null, port: body.port || null };
      return id ? api.patch(`/admin/presets/${id}`, payload) : api.post('/admin/presets', payload);
    },
    ['admin-presets', 'presets'],
  );
  const remove = useAdminMutation((id: string) => api.del(`/admin/presets/${id}`), ['admin-presets', 'presets'], 'Deleted');
  return (
    <>
      <PageHeader title="Provider presets" description="Shown to users when they add a provider." actions={<Button onClick={() => setEditing({ ...emptyPreset })}><PlusIcon />New preset</Button>} />
      {isLoading ? <Loading /> : (
        <Card>
          <Table>
            <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Type</TableHead><TableHead>Host</TableHead><TableHead>Cap</TableHead><TableHead /></TableRow></TableHeader>
            <TableBody>
              {data?.map((p) => (
                <TableRow key={p.id}>
                  <TableCell>{p.name}{!p.active && <Badge variant="secondary" className="ml-2">hidden</Badge>}</TableCell>
                  <TableCell>{providerLabel[p.type]}</TableCell>
                  <TableCell className="font-mono text-xs">{p.host ? `${p.host}:${p.port}` : '—'}</TableCell>
                  <TableCell>{p.dailyCap ?? '—'}</TableCell>
                  <TableCell className="text-right">
                    <Button size="xs" variant="outline" onClick={() => setEditing({ ...p })}>Edit</Button>
                    <Button size="xs" variant="ghost" onClick={() => remove.mutate(p.id)}>Delete</Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
      <Dialog open={!!editing} onOpenChange={() => setEditing(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing?.id ? 'Edit preset' : 'New preset'}</DialogTitle></DialogHeader>
          {editing && (
            <form className="grid gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); save.mutate(editing, { onSuccess: () => setEditing(null) }); }}>
              <Field label="Name"><Input required value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></Field>
              <Field label="Type">
                <NativeSelect value={editing.type} onChange={(e) => setEditing({ ...editing, type: e.target.value as ProviderType })}>
                  {Object.entries(providerLabel).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </NativeSelect>
              </Field>
              <Field label="Host"><Input value={editing.host ?? ''} onChange={(e) => setEditing({ ...editing, host: e.target.value })} /></Field>
              <Field label="Port"><Input type="number" value={editing.port ?? ''} onChange={(e) => setEditing({ ...editing, port: Number(e.target.value) || null, secure: Number(e.target.value) === 465 })} /></Field>
              <Field label="Daily cap"><Input type="number" value={editing.dailyCap ?? ''} onChange={(e) => setEditing({ ...editing, dailyCap: Number(e.target.value) || null })} /></Field>
              <Field label="Sort order"><Input type="number" value={editing.sortOrder} onChange={(e) => setEditing({ ...editing, sortOrder: Number(e.target.value) })} /></Field>
              <Field label="Help URL" className="sm:col-span-2"><Input value={editing.helpUrl ?? ''} onChange={(e) => setEditing({ ...editing, helpUrl: e.target.value })} /></Field>
              <div className="flex items-center gap-2 text-sm"><Switch checked={editing.active} onCheckedChange={(v) => setEditing({ ...editing, active: v })} />Visible to users</div>
              <DialogFooter className="sm:col-span-2"><Button type="submit" disabled={save.isPending}>Save</Button></DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

export function AdminTemplatesPage() {
  const { data, isLoading } = useQuery({ queryKey: ['admin-templates'], queryFn: () => api.get<Template[]>('/admin/templates') });
  const [editing, setEditing] = useState<{ id?: string; name: string; slug: string; description: string; subject: string; body: string; sampleData: string } | null>(null);
  const save = useAdminMutation(
    (t: NonNullable<typeof editing>) => {
      const version = { subject: t.subject, format: 'mjml', body: t.body, sampleData: JSON.parse(t.sampleData || '{}') };
      return t.id
        ? api.put(`/admin/templates/${t.id}`, { name: t.name, description: t.description, version })
        : api.post('/admin/templates', { name: t.name, slug: t.slug, description: t.description, isGallery: true, version });
    },
    ['admin-templates', 'gallery'],
  );
  const remove = useAdminMutation((id: string) => api.del(`/admin/templates/${id}`), ['admin-templates', 'gallery'], 'Deleted');
  return (
    <>
      <PageHeader title="Gallery templates" description="System templates users can start from (MJML fragments inside the default layout)." actions={<Button onClick={() => setEditing({ name: '', slug: '', description: '', subject: '', body: '<mj-text>Hello {{name}}</mj-text>', sampleData: '{"name":"Asha","brand":"Acme"}' })}><PlusIcon />New template</Button>} />
      {isLoading ? <Loading /> : (
        <Card>
          <Table>
            <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Slug</TableHead><TableHead>Version</TableHead><TableHead /></TableRow></TableHeader>
            <TableBody>
              {data?.map((t) => (
                <TableRow key={t.id}>
                  <TableCell>{t.name}<p className="text-xs text-muted-foreground">{t.description}</p></TableCell>
                  <TableCell className="font-mono text-xs">{t.slug}</TableCell>
                  <TableCell>v{t.currentVersion}</TableCell>
                  <TableCell className="text-right">
                    <Button size="xs" variant="outline" onClick={() => setEditing({ id: t.id, name: t.name, slug: t.slug, description: t.description ?? '', subject: t.versions[0]?.subject ?? '', body: t.versions[0]?.body ?? '', sampleData: JSON.stringify(t.versions[0]?.sampleData ?? {}, null, 2) })}>Edit</Button>
                    <Button size="xs" variant="ghost" onClick={() => remove.mutate(t.id)}>Delete</Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
      <Dialog open={!!editing} onOpenChange={() => setEditing(null)}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader><DialogTitle>{editing?.id ? 'Edit template' : 'New gallery template'}</DialogTitle></DialogHeader>
          {editing && (
            <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); save.mutate(editing, { onSuccess: () => setEditing(null) }); }}>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Name"><Input required value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></Field>
                <Field label="Slug"><Input required disabled={!!editing.id} value={editing.slug} onChange={(e) => setEditing({ ...editing, slug: e.target.value })} /></Field>
              </div>
              <Field label="Description"><Input value={editing.description} onChange={(e) => setEditing({ ...editing, description: e.target.value })} /></Field>
              <Field label="Subject"><Input required value={editing.subject} onChange={(e) => setEditing({ ...editing, subject: e.target.value })} /></Field>
              <Field label="MJML body"><Textarea rows={8} className="font-mono text-xs" value={editing.body} onChange={(e) => setEditing({ ...editing, body: e.target.value })} /></Field>
              <Field label="Sample data (JSON)"><Textarea rows={3} className="font-mono text-xs" value={editing.sampleData} onChange={(e) => setEditing({ ...editing, sampleData: e.target.value })} /></Field>
              <DialogFooter><Button type="submit" disabled={save.isPending}>Save</Button></DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

export function AdminMessagesPage() {
  return (
    <>
      <PageHeader title="All messages" />
      <MessageTable basePath="/admin/messages" endpoint="/admin/messages" showUser />
    </>
  );
}

export const AdminMessageDetailPage = () => <MessageDetailView endpoint="/admin/messages" back="/admin/messages" />;

export function AdminSettingsPage() {
  const { data, isLoading } = useQuery({ queryKey: ['admin-settings'], queryFn: () => api.get<{ key: string; value: unknown }[]>('/admin/settings') });
  const save = useAdminMutation(({ key, value }: { key: string; value: unknown }) => api.put(`/admin/settings/${key}`, { value }), ['admin-settings', 'settings-public']);
  const get = (k: string) => data?.find((s) => s.key === k)?.value;
  const [banner, setBanner] = useState<string>();
  if (isLoading) return <Loading />;
  return (
    <>
      <PageHeader title="Platform settings" />
      <Card className="max-w-2xl">
        <CardContent className="grid gap-5">
          <div className="flex items-center justify-between text-sm">
            <div><p className="font-medium">Allow new signups</p><p className="text-muted-foreground">Turn off to close registration (email and Google).</p></div>
            <Switch checked={get('signup_enabled') !== false} onCheckedChange={(v) => save.mutate({ key: 'signup_enabled', value: v })} />
          </div>
          <Field label="Announcement banner" hint="Shown at the top of every dashboard page. Leave empty to hide.">
            <div className="flex gap-2">
              <Input value={banner ?? String(get('banner') ?? '')} onChange={(e) => setBanner(e.target.value)} />
              <Button variant="outline" onClick={() => save.mutate({ key: 'banner', value: banner || null })}>Save</Button>
            </div>
          </Field>
        </CardContent>
      </Card>
    </>
  );
}

export function AdminAuditPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['admin-audit'],
    queryFn: () => api.get<{ id: string; action: string; targetType: string; targetId: string | null; meta: unknown; createdAt: string; admin: { email: string } }[]>('/admin/audit'),
  });
  return (
    <>
      <PageHeader title="Audit log" description="Every admin change is recorded." />
      {isLoading ? <Loading /> : (
        <Card>
          <Table>
            <TableHeader><TableRow><TableHead>When</TableHead><TableHead>Admin</TableHead><TableHead>Action</TableHead><TableHead>Target</TableHead><TableHead>Details</TableHead></TableRow></TableHeader>
            <TableBody>
              {data?.map((a) => (
                <TableRow key={a.id}>
                  <TableCell className="whitespace-nowrap text-muted-foreground">{fmtDate(a.createdAt)}</TableCell>
                  <TableCell>{a.admin.email}</TableCell>
                  <TableCell className="font-mono text-xs">{a.action}</TableCell>
                  <TableCell className="font-mono text-xs">{a.targetType}:{a.targetId?.slice(0, 10)}</TableCell>
                  <TableCell className="max-w-64 truncate font-mono text-xs text-muted-foreground">{a.meta ? JSON.stringify(a.meta) : ''}</TableCell>
                </TableRow>
              ))}
              {!data?.length && <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">No admin actions yet</TableCell></TableRow>}
            </TableBody>
          </Table>
        </Card>
      )}
    </>
  );
}
