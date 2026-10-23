import { ConfirmDialog, EmptyState, ErrorNote, Field, Loading, PageHeader } from '@/components/common';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { api, errorMessage } from '@/lib/api';
import { fmtDate, providerLabel } from '@/lib/format';
import type { Preset, Provider, ProviderType } from '@/lib/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangleIcon, ArrowDownIcon, ArrowUpIcon, CheckCircle2Icon, Loader2Icon, PencilIcon, PlusIcon, RotateCcwIcon, Trash2Icon, XCircleIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';

interface TestResult { ok: boolean; durationMs: number; error?: string; side?: 'provider' | 'recipient'; auth?: boolean }

const configFields: Record<ProviderType, { key: string; label: string; type?: string; secret?: boolean; hint?: string }[]> = {
  smtp: [
    { key: 'host', label: 'SMTP host' },
    { key: 'port', label: 'Port', type: 'number', hint: '465 = TLS, 587 = STARTTLS' },
    { key: 'user', label: 'Username' },
    { key: 'pass', label: 'Password / app password', type: 'password', secret: true },
  ],
  resend: [{ key: 'apiKey', label: 'API key', type: 'password', secret: true }],
  ses: [
    { key: 'region', label: 'AWS region', hint: 'e.g. ap-south-1' },
    { key: 'accessKeyId', label: 'Access key ID' },
    { key: 'secretAccessKey', label: 'Secret access key', type: 'password', secret: true },
  ],
  gmail_oauth: [],
};

interface FormState {
  name: string;
  type: ProviderType;
  fromEmail: string;
  fromName: string;
  dailyCap: string;
  ratePerSecond: string;
  config: Record<string, string | number | boolean>;
  helpUrl?: string | null;
}

const emptyForm = (preset?: Preset): FormState => ({
  name: preset?.name ?? '',
  type: preset?.type ?? 'smtp',
  fromEmail: '',
  fromName: '',
  dailyCap: preset?.dailyCap ? String(preset.dailyCap) : '',
  ratePerSecond: '',
  helpUrl: preset?.helpUrl,
  config: preset?.type === 'smtp' ? { host: preset.host ?? '', port: preset.port ?? 465, secure: preset.secure ?? true, user: '', pass: '' } : {},
});

function ProviderDialog({ open, onOpenChange, editing }: { open: boolean; onOpenChange: (o: boolean) => void; editing?: Provider }) {
  const qc = useQueryClient();
  const presets = useQuery({ queryKey: ['presets'], queryFn: () => api.get<Preset[]>('/providers/presets') });
  const [form, setForm] = useState<FormState | null>(null);
  const [test, setTest] = useState<TestResult | null>(null);

  useEffect(() => {
    if (!open) return;
    setTest(null);
    setForm(
      editing
        ? {
            name: editing.name,
            type: editing.type,
            fromEmail: editing.fromEmail,
            fromName: editing.fromName ?? '',
            dailyCap: editing.dailyCap ? String(editing.dailyCap) : '',
            ratePerSecond: editing.ratePerSecond ? String(editing.ratePerSecond) : '',
            config: editing.config as FormState['config'],
          }
        : null,
    );
  }, [open, editing]);

  const config = () => {
    if (!form) return {};
    const c = { ...form.config };
    if (form.type === 'smtp') {
      c.port = Number(c.port);
      c.secure = Number(c.port) === 465;
    }
    return c;
  };
  const meta = () => ({
    name: form!.name,
    fromEmail: form!.fromEmail,
    fromName: form!.fromName || null,
    dailyCap: form!.dailyCap ? Number(form!.dailyCap) : null,
    ratePerSecond: form!.ratePerSecond ? Number(form!.ratePerSecond) : null,
  });

  const runTest = useMutation({
    mutationFn: () => api.post<TestResult>('/providers/test', { type: form!.type, config: config(), fromEmail: form!.fromEmail, fromName: form!.fromName || null, providerId: editing?.id }),
    onSuccess: setTest,
    onError: (e) => setTest({ ok: false, durationMs: 0, error: errorMessage(e) }),
  });
  const save = useMutation({
    mutationFn: () => (editing ? api.patch(`/providers/${editing.id}`, { ...meta(), config: config() }) : api.post('/providers', { ...meta(), type: form!.type, config: config() })),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['providers'] });
      toast.success(editing ? 'Provider updated' : 'Provider added');
      onOpenChange(false);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const connectGmail = useMutation({
    mutationFn: () => api.post<{ url: string }>('/providers/gmail/authorize', { name: form!.name, fromName: form!.fromName || null, dailyCap: form!.dailyCap ? Number(form!.dailyCap) : null }),
    onSuccess: ({ url }) => { window.location.href = url; },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const set = (patch: Partial<FormState>) => setForm((f) => (f ? { ...f, ...patch } : f));
  const setConfig = (key: string, value: string) => setForm((f) => (f ? { ...f, config: { ...f.config, [key]: value } } : f));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? `Edit ${editing.name}` : 'Add a provider'}</DialogTitle>
          <DialogDescription>Credentials are encrypted with AES-256-GCM and never shown again. Test before saving — nothing is stored during a test.</DialogDescription>
        </DialogHeader>
        {!form ? (
          <div className="grid gap-2 sm:grid-cols-2">
            {presets.isLoading && <Loading />}
            {presets.data?.map((p) => (
              <button key={p.id} type="button" onClick={() => setForm(emptyForm(p))} className="rounded-lg border p-3 text-left text-sm transition-colors hover:bg-muted">
                <p className="font-medium">{p.name}</p>
                <p className="text-xs text-muted-foreground">{providerLabel[p.type]}{p.dailyCap ? ` · ~${p.dailyCap}/day` : ''}</p>
              </button>
            ))}
          </div>
        ) : (
          <form className="grid max-h-[65vh] gap-3 overflow-y-auto pr-1" onSubmit={(e) => { e.preventDefault(); if (form.type === 'gmail_oauth') connectGmail.mutate(); else save.mutate(); }}>
            <Field label="Display name"><Input required value={form.name} onChange={(e) => set({ name: e.target.value })} /></Field>
            {form.type !== 'gmail_oauth' && (
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="From email"><Input type="email" required value={form.fromEmail} onChange={(e) => set({ fromEmail: e.target.value })} /></Field>
                <Field label="From name"><Input value={form.fromName} onChange={(e) => set({ fromName: e.target.value })} placeholder="Acme" /></Field>
              </div>
            )}
            {form.type === 'gmail_oauth' && (
              <>
                <Field label="From name"><Input value={form.fromName} onChange={(e) => set({ fromName: e.target.value })} placeholder="Acme" /></Field>
                <p className="text-sm text-muted-foreground">You'll be sent to Google to allow PingX to send email as your Gmail account (gmail.send scope only).</p>
              </>
            )}
            {configFields[form.type].map((f) => (
              <Field key={f.key} label={f.label} hint={f.hint}>
                <Input
                  type={f.type ?? 'text'}
                  required
                  value={String(form.config[f.key] ?? '')}
                  onFocus={(e) => { if (f.secret && e.target.value === '••••') setConfig(f.key, ''); }}
                  onBlur={(e) => { if (f.secret && editing && !e.target.value) setConfig(f.key, '••••'); }}
                  onChange={(e) => setConfig(f.key, e.target.value)}
                />
              </Field>
            ))}
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Daily cap" hint="Skip this provider after N sends/day"><Input type="number" min={1} value={form.dailyCap} onChange={(e) => set({ dailyCap: e.target.value })} /></Field>
              {form.type !== 'gmail_oauth' && <Field label="Max per second"><Input type="number" min={1} value={form.ratePerSecond} onChange={(e) => set({ ratePerSecond: e.target.value })} /></Field>}
            </div>
            {form.helpUrl && <a className="text-xs text-muted-foreground underline" href={form.helpUrl} target="_blank" rel="noreferrer">Where do I find these credentials?</a>}
            {test && (
              <div className={`flex gap-2 rounded-lg border p-3 text-sm ${test.ok ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-destructive/30 bg-destructive/5'}`}>
                {test.ok ? <CheckCircle2Icon className="size-4 shrink-0 text-emerald-600" /> : <XCircleIcon className="size-4 shrink-0 text-destructive" />}
                <div>
                  <p className="font-medium">{test.ok ? `Test email sent in ${test.durationMs} ms — check your inbox.` : 'Test failed'}</p>
                  {test.error && <p className="mt-1 break-words text-xs text-muted-foreground">{test.auth ? 'Authentication failed: ' : ''}{test.error}</p>}
                </div>
              </div>
            )}
            <DialogFooter className="gap-2">
              {!editing && <Button type="button" variant="ghost" onClick={() => setForm(null)}>Back</Button>}
              {form.type === 'gmail_oauth' ? (
                <Button type="submit" disabled={connectGmail.isPending}>Connect with Google</Button>
              ) : (
                <>
                  <Button type="button" variant="outline" disabled={runTest.isPending || !form.fromEmail} onClick={() => runTest.mutate()}>
                    {runTest.isPending && <Loader2Icon className="animate-spin" />}Send test email
                  </Button>
                  <Button type="submit" disabled={save.isPending}>{editing ? 'Save changes' : 'Save provider'}</Button>
                </>
              )}
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function ProvidersPage() {
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const [dialog, setDialog] = useState<{ open: boolean; editing?: Provider }>({ open: false });
  const [deleting, setDeleting] = useState<Provider | null>(null);
  const { data, isLoading, error } = useQuery({ queryKey: ['providers'], queryFn: () => api.get<Provider[]>('/providers') });

  useEffect(() => {
    if (params.get('gmail_connected')) toast.success('Gmail connected');
    if (params.get('gmail_error')) toast.error(`Gmail connection failed: ${params.get('gmail_error')}`);
    if (params.size) setParams({}, { replace: true });
  }, [params, setParams]);

  const reorder = useMutation({
    mutationFn: (ids: string[]) => api.put('/providers/order', { ids }),
    onSettled: () => qc.invalidateQueries({ queryKey: ['providers'] }),
  });
  const resetHealth = useMutation({
    mutationFn: (id: string) => api.post(`/providers/${id}/reset-health`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['providers'] }); toast.success('Provider re-enabled'); },
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/providers/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['providers'] }); setDeleting(null); },
  });

  const move = (i: number, dir: -1 | 1) => {
    if (!data) return;
    const ids = data.map((p) => p.id);
    [ids[i], ids[i + dir]] = [ids[i + dir]!, ids[i]!];
    qc.setQueryData<Provider[]>(['providers'], ids.map((id, idx) => ({ ...data.find((p) => p.id === id)!, priority: idx + 1 })));
    reorder.mutate(ids);
  };

  return (
    <>
      <PageHeader
        title="Providers"
        description="Your own email accounts. PingX tries them in order and falls back to the next one on provider errors (auth, limits, timeouts) — never on bad recipient addresses."
        actions={<Button onClick={() => setDialog({ open: true })}><PlusIcon />Add provider</Button>}
      />
      {isLoading ? <Loading /> : error ? <ErrorNote error={error} /> : !data?.length ? (
        <EmptyState title="No providers yet" description="Connect Gmail, Outlook, Zoho, any SMTP server, Resend or Amazon SES." action={<Button onClick={() => setDialog({ open: true })}>Add your first provider</Button>} />
      ) : (
        <div className="grid gap-3">
          {data.map((p, i) => (
            <Card key={p.id}>
              <CardContent className="flex flex-wrap items-center gap-4">
                <div className="flex flex-col">
                  <Button size="icon-xs" variant="ghost" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up"><ArrowUpIcon /></Button>
                  <Button size="icon-xs" variant="ghost" disabled={i === data.length - 1} onClick={() => move(i, 1)} aria-label="Move down"><ArrowDownIcon /></Button>
                </div>
                <div className="grid size-8 place-items-center rounded-full bg-muted text-sm font-semibold">{p.priority}</div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium">{p.name}</p>
                    <Badge variant="outline">{providerLabel[p.type]}</Badge>
                    {i === 0 && <Badge>Default</Badge>}
                    {p.healthy ? (
                      <Badge variant="outline" className="border-transparent bg-emerald-500/10 text-emerald-700 dark:text-emerald-400">Healthy</Badge>
                    ) : (
                      <Badge variant="outline" className="border-transparent bg-red-500/10 text-red-700 dark:text-red-400"><AlertTriangleIcon />Disabled</Badge>
                    )}
                  </div>
                  <p className="truncate text-sm text-muted-foreground">
                    {p.fromName ? `${p.fromName} <${p.fromEmail}>` : p.fromEmail}
                    {p.dailyCap ? ` · cap ${p.dailyCap}/day` : ''} · last used {fmtDate(p.lastUsedAt)}
                  </p>
                  {p.lastError && <p className="mt-1 truncate text-xs text-destructive" title={p.lastError}>Last error: {p.lastError}</p>}
                </div>
                <div className="flex gap-1">
                  {!p.healthy && <Button size="sm" variant="outline" onClick={() => resetHealth.mutate(p.id)}><RotateCcwIcon />Re-enable</Button>}
                  {p.type !== 'gmail_oauth' && <Button size="icon-sm" variant="ghost" onClick={() => setDialog({ open: true, editing: p })} aria-label="Edit"><PencilIcon /></Button>}
                  <Button size="icon-sm" variant="ghost" onClick={() => setDeleting(p)} aria-label="Delete"><Trash2Icon /></Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      <ProviderDialog open={dialog.open} editing={dialog.editing} onOpenChange={(open) => setDialog({ open })} />
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={() => setDeleting(null)}
        title={`Remove ${deleting?.name}?`}
        description="Messages will use your remaining providers. Stored credentials are deleted."
        onConfirm={() => deleting && remove.mutate(deleting.id)}
        pending={remove.isPending}
      />
    </>
  );
}

