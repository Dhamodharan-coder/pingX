import { Code, ConfirmDialog, CopyButton, EmptyState, ErrorNote, Field, Loading, NativeSelect, PageHeader } from '@/components/common';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { api, errorMessage } from '@/lib/api';
import { fmtDate } from '@/lib/format';
import type { Project, Provider } from '@/lib/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRoundIcon, PlusIcon, Trash2Icon, WebhookIcon } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';

export function ProjectsPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const { data, isLoading, error } = useQuery({ queryKey: ['projects'], queryFn: () => api.get<Project[]>('/projects') });
  const create = useMutation({
    mutationFn: () => api.post<Project>('/projects', { name }),
    onSuccess: (p) => {
      qc.invalidateQueries({ queryKey: ['projects'] });
      setOpen(false);
      setName('');
      navigate(`/projects/${p.id}`);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <>
      <PageHeader
        title="Projects"
        description="Each project has its own API keys, webhooks and message log. Providers are shared by all projects."
        actions={<Button onClick={() => setOpen(true)}><PlusIcon />New project</Button>}
      />
      {isLoading ? <Loading /> : error ? <ErrorNote error={error} /> : !data?.length ? (
        <EmptyState title="No projects yet" description="Create a project for each app or website that sends email." action={<Button onClick={() => setOpen(true)}>Create project</Button>} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {data.map((p) => (
            <Link key={p.id} to={`/projects/${p.id}`}>
              <Card className="transition-colors hover:bg-muted/40">
                <CardHeader>
                  <CardTitle>{p.name}</CardTitle>
                  <CardDescription>Created {fmtDate(p.createdAt)}</CardDescription>
                </CardHeader>
                <CardContent className="flex gap-4 text-sm text-muted-foreground">
                  <span>{p._count?.apiKeys ?? 0} keys</span>
                  <span>{p._count?.messages ?? 0} messages</span>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>New project</DialogTitle></DialogHeader>
          <form onSubmit={(e) => { e.preventDefault(); create.mutate(); }} className="grid gap-4">
            <Field label="Name"><Input autoFocus required value={name} onChange={(e) => setName(e.target.value)} placeholder="My website" /></Field>
            <DialogFooter><Button type="submit" disabled={create.isPending}>Create</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

interface ApiKeyRow { id: string; name: string; prefix: string; lastUsedAt: string | null; revokedAt: string | null; createdAt: string }
interface WebhookRow { id: string; url: string; events: string[]; active: boolean }

export function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const project = useQuery({ queryKey: ['projects'], queryFn: () => api.get<Project[]>('/projects'), select: (ps) => ps.find((p) => p.id === id) });
  const providers = useQuery({ queryKey: ['providers'], queryFn: () => api.get<Provider[]>('/providers') });
  const keys = useQuery({ queryKey: ['api-keys', id], queryFn: () => api.get<ApiKeyRow[]>(`/projects/${id}/api-keys`) });
  const hooks = useQuery({ queryKey: ['webhooks', id], queryFn: () => api.get<WebhookRow[]>(`/projects/${id}/webhooks`) });
  const [newKey, setNewKey] = useState<string | null>(null);
  const [keyTab, setKeyTab] = useState<'active' | 'revoked'>('active');
  const [revoking, setRevoking] = useState<ApiKeyRow | null>(null);
  const [keyName, setKeyName] = useState('');
  const [hookUrl, setHookUrl] = useState('');
  const [hookSecret, setHookSecret] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [name, setName] = useState<string>();

  const update = useMutation({
    mutationFn: (body: Partial<Project>) => api.patch(`/projects/${id}`, body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['projects'] }); toast.success('Project updated'); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const createKey = useMutation({
    mutationFn: () => api.post<{ key: string }>(`/projects/${id}/api-keys`, { name: keyName || 'Default' }),
    onSuccess: (r) => { setNewKey(r.key); setKeyName(''); qc.invalidateQueries({ queryKey: ['api-keys', id] }); qc.invalidateQueries({ queryKey: ['projects'] }); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const revokeKey = useMutation({
    mutationFn: (keyId: string) => api.del(`/projects/${id}/api-keys/${keyId}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['api-keys', id] }); qc.invalidateQueries({ queryKey: ['projects'] }); setRevoking(null); toast.success('Key revoked'); },
  });
  const createHook = useMutation({
    mutationFn: () => api.post<{ secret: string }>(`/projects/${id}/webhooks`, { url: hookUrl }),
    onSuccess: (r) => { setHookSecret(r.secret); setHookUrl(''); qc.invalidateQueries({ queryKey: ['webhooks', id] }); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const deleteHook = useMutation({
    mutationFn: (wid: string) => api.del(`/projects/${id}/webhooks/${wid}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['webhooks', id] }),
  });
  const testHook = useMutation({
    mutationFn: (wid: string) => api.post(`/projects/${id}/webhooks/${wid}/test`),
    onSuccess: () => toast.success('Test event queued'),
  });
  const remove = useMutation({
    mutationFn: () => api.del(`/projects/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['projects'] }); navigate('/projects'); },
  });

  if (project.isLoading) return <Loading />;
  if (!project.data) return <ErrorNote error={new Error('Project not found')} />;
  const p = project.data;

  return (
    <>
      <PageHeader title={p.name} description={<span className="font-mono text-xs">{p.id}</span>} actions={<Button variant="destructive" onClick={() => setConfirmDelete(true)}><Trash2Icon />Delete</Button>} />
      <div className="grid gap-6">
        <Card>
          <CardHeader><CardTitle>Settings</CardTitle></CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field label="Name">
              <div className="flex gap-2">
                <Input value={name ?? p.name} onChange={(e) => setName(e.target.value)} />
                <Button variant="outline" disabled={!name || name === p.name} onClick={() => update.mutate({ name })}>Save</Button>
              </div>
            </Field>
            <Field label="Default provider" hint="Tried first for this project; the rest of your providers stay as fallbacks.">
              <NativeSelect value={p.defaultProviderId ?? ''} onChange={(e) => update.mutate({ defaultProviderId: e.target.value || null })}>
                <option value="">Use account priority order</option>
                {providers.data?.map((pr) => <option key={pr.id} value={pr.id}>{pr.name}</option>)}
              </NativeSelect>
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><KeyRoundIcon className="size-4" />API keys</CardTitle>
            <CardDescription>Use a key as <code>Authorization: Bearer pgx_live_…</code>. Keys are shown once.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); createKey.mutate(); }}>
              <Input placeholder="Key name (e.g. production)" value={keyName} onChange={(e) => setKeyName(e.target.value)} className="max-w-xs" />
              <Button type="submit" disabled={createKey.isPending}><PlusIcon />Create key</Button>
            </form>
            {(() => {
              const all = keys.data ?? [];
              const active = all.filter((k) => !k.revokedAt);
              const revoked = all.filter((k) => k.revokedAt);
              const shown = keyTab === 'active' ? active : revoked;
              return (
                <div className="grid gap-3">
                  <Tabs value={keyTab} onValueChange={(v) => setKeyTab(v as 'active' | 'revoked')}>
                    <TabsList>
                      <TabsTrigger value="active">Active ({active.length})</TabsTrigger>
                      <TabsTrigger value="revoked">Revoked ({revoked.length})</TabsTrigger>
                    </TabsList>
                  </Tabs>
                  {shown.length ? (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Name</TableHead>
                          <TableHead>Key</TableHead>
                          <TableHead>Created</TableHead>
                          <TableHead>{keyTab === 'active' ? 'Last used' : 'Revoked'}</TableHead>
                          {keyTab === 'active' && <TableHead />}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {shown.map((k) => (
                          <TableRow key={k.id}>
                            <TableCell>{k.name}</TableCell>
                            <TableCell className="font-mono text-xs">{k.prefix}…</TableCell>
                            <TableCell className="text-muted-foreground">{fmtDate(k.createdAt)}</TableCell>
                            <TableCell className="text-muted-foreground">{fmtDate(keyTab === 'active' ? k.lastUsedAt : k.revokedAt)}</TableCell>
                            {keyTab === 'active' && (
                              <TableCell className="text-right">
                                <Button size="xs" variant="ghost" onClick={() => setRevoking(k)}>Revoke</Button>
                              </TableCell>
                            )}
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  ) : (
                    <p className="text-sm text-muted-foreground">{keyTab === 'active' ? 'No active keys. Create one above.' : 'No revoked keys.'}</p>
                  )}
                </div>
              );
            })()}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><WebhookIcon className="size-4" />Webhooks</CardTitle>
            <CardDescription>
              We POST <code>message.sent</code> and <code>message.failed</code> events, signed with <code>PingX-Signature: t=…,v1=HMAC-SHA256(secret, "t.body")</code>.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); createHook.mutate(); }}>
              <Input type="url" required placeholder="https://example.com/pingx-webhook" value={hookUrl} onChange={(e) => setHookUrl(e.target.value)} />
              <Button type="submit" disabled={createHook.isPending}><PlusIcon />Add</Button>
            </form>
            {hooks.data?.map((h) => (
              <div key={h.id} className="flex items-center justify-between gap-2 rounded-lg border p-3 text-sm">
                <div className="min-w-0">
                  <p className="truncate font-mono text-xs">{h.url}</p>
                  <p className="text-xs text-muted-foreground">{h.events.join(', ')}</p>
                </div>
                <div className="flex shrink-0 gap-1">
                  <Button size="xs" variant="outline" onClick={() => testHook.mutate(h.id)}>Send test</Button>
                  <Button size="xs" variant="ghost" onClick={() => deleteHook.mutate(h.id)}>Delete</Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Dialog open={!!newKey} onOpenChange={() => setNewKey(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Your new API key</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">Copy it now. For your security we only store a hash and can't show it again.</p>
          <Code className="break-all whitespace-pre-wrap">{newKey}</Code>
          <DialogFooter><CopyButton value={newKey ?? ''} /></DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={!!hookSecret} onOpenChange={() => setHookSecret(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Webhook signing secret</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">Use this to verify the PingX-Signature header. It is shown once.</p>
          <Code className="break-all whitespace-pre-wrap">{hookSecret}</Code>
          <DialogFooter><CopyButton value={hookSecret ?? ''} /></DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={!!revoking}
        onOpenChange={() => setRevoking(null)}
        title={`Revoke key "${revoking?.name}"?`}
        description={<>Requests using <code>{revoking?.prefix}…</code> will fail with 401 immediately. This can't be undone.</>}
        confirmLabel="Revoke"
        onConfirm={() => revoking && revokeKey.mutate(revoking.id)}
        pending={revokeKey.isPending}
      />
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Delete ${p.name}?`}
        description="This deletes its API keys, webhooks and message history. It cannot be undone."
        onConfirm={() => remove.mutate()}
        pending={remove.isPending}
      />
    </>
  );
}
