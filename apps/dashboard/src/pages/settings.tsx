import { Field, NativeSelect, PageHeader } from '@/components/common';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2Icon, Loader2Icon, XCircleIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

export function SettingsPage() {
  const { user, reload } = useAuth();
  const [name, setName] = useState(user?.name ?? '');
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '' });
  const saveName = useMutation({
    mutationFn: () => api.patch('/auth/me', { name }),
    onSuccess: () => { void reload(); toast.success('Saved'); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const resend = useMutation({
    mutationFn: () => api.post('/auth/resend-verification'),
    onSuccess: () => toast.success('Verification email sent'),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const changePw = useMutation({
    mutationFn: () => api.post('/auth/change-password', pw),
    onSuccess: () => { setPw({ currentPassword: '', newPassword: '' }); toast.success('Password updated'); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  if (!user) return null;
  return (
    <>
      <PageHeader title="Settings" />
      <div className="grid max-w-2xl gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Profile</CardTitle>
            <CardDescription>{user.email}{user.emailVerified ? ' · verified' : ''}</CardDescription>
          </CardHeader>
          {!user.emailVerified && (
            <CardContent>
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-300">
                <span>Your email is not verified yet. Open the link we emailed you to start sending.</span>
                <Button size="sm" variant="outline" disabled={resend.isPending || resend.isSuccess} onClick={() => resend.mutate()}>
                  {resend.isSuccess ? 'Sent — check your inbox' : 'Resend verification email'}
                </Button>
              </div>
            </CardContent>
          )}
          <CardContent>
            <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); saveName.mutate(); }}>
              <Field label="Name" className="flex-1"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
              <Button type="submit" variant="outline" disabled={saveName.isPending}>Save</Button>
            </form>
          </CardContent>
        </Card>
        <AiCard />
        <Card>
          <CardHeader><CardTitle>{user.hasPassword ? 'Change password' : 'Set a password'}</CardTitle></CardHeader>
          <CardContent>
            <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); changePw.mutate(); }}>
              {user.hasPassword && <Field label="Current password"><Input type="password" required value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} /></Field>}
              <Field label="New password" hint="At least 8 characters"><Input type="password" minLength={8} required value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} /></Field>
              <Button type="submit" className="justify-self-start" disabled={changePw.isPending}>Update password</Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </>
  );
}

type AiProvider = 'anthropic' | 'openai' | 'gemini' | 'openai_compatible';
interface AiSetting { provider: AiProvider; model: string; baseUrl: string | null; apiKey: string }

const AI_PROVIDERS: Record<AiProvider, { label: string; model: string; modelHint: string; keyUrl?: string }> = {
  anthropic: { label: 'Anthropic (Claude)', model: 'claude-opus-5-5', modelHint: 'Leave as is or use another Claude model id', keyUrl: 'https://console.anthropic.com/settings/keys' },
  openai: { label: 'OpenAI', model: '', modelHint: 'A model id from your OpenAI account', keyUrl: 'https://platform.openai.com/api-keys' },
  gemini: { label: 'Google Gemini', model: '', modelHint: 'A Gemini model id from Google AI Studio', keyUrl: 'https://aistudio.google.com/apikey' },
  openai_compatible: { label: 'OpenAI-compatible (Groq, OpenRouter, Ollama…)', model: '', modelHint: 'Model id as your provider names it' },
};

function AiCard() {
  const qc = useQueryClient();
  const saved = useQuery({ queryKey: ['account-ai'], queryFn: () => api.get<AiSetting | null>('/account/ai') });
  const [form, setForm] = useState<AiSetting>({ provider: 'anthropic', model: AI_PROVIDERS.anthropic.model, baseUrl: '', apiKey: '' });
  const [test, setTest] = useState<{ ok: boolean; durationMs: number; error?: string } | null>(null);

  useEffect(() => {
    if (saved.data) setForm({ ...saved.data, baseUrl: saved.data.baseUrl ?? '' });
  }, [saved.data]);

  const payload = () => ({ provider: form.provider, model: form.model, baseUrl: form.provider === 'openai_compatible' ? form.baseUrl : null, apiKey: form.apiKey || undefined });
  const runTest = useMutation({
    mutationFn: () => api.post<{ ok: boolean; durationMs: number; error?: string }>('/account/ai/test', payload()),
    onSuccess: setTest,
    onError: (e) => setTest({ ok: false, durationMs: 0, error: errorMessage(e) }),
  });
  const save = useMutation({
    mutationFn: () => api.put<AiSetting>('/account/ai', payload()),
    onSuccess: (r) => { qc.setQueryData(['account-ai'], r); toast.success('AI assistant saved'); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: () => api.del('/account/ai'),
    onSuccess: () => {
      qc.setQueryData(['account-ai'], null);
      setForm({ provider: 'anthropic', model: AI_PROVIDERS.anthropic.model, baseUrl: '', apiKey: '' });
      setTest(null);
      toast.success('AI provider removed');
    },
  });

  const meta = AI_PROVIDERS[form.provider];
  return (
    <Card>
      <CardHeader>
        <CardTitle>AI assistant</CardTitle>
        <CardDescription>
          Use your own AI account to generate templates. Your API key is encrypted and never shown again; you pay your provider directly.
          {saved.data ? ` Currently using ${AI_PROVIDERS[saved.data.provider].label} · ${saved.data.model}.` : ' Not set up yet.'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
          <Field label="Provider">
            <NativeSelect
              value={form.provider}
              onChange={(e) => {
                const provider = e.target.value as AiProvider;
                setTest(null);
                setForm({ ...form, provider, model: saved.data?.provider === provider ? saved.data.model : AI_PROVIDERS[provider].model });
              }}
            >
              {Object.entries(AI_PROVIDERS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </NativeSelect>
          </Field>
          {form.provider === 'openai_compatible' && (
            <Field label="Base URL" hint="e.g. https://api.groq.com/openai/v1, https://openrouter.ai/api/v1, http://localhost:11434/v1 (Ollama, dev only)">
              <Input type="url" required value={form.baseUrl ?? ''} onChange={(e) => setForm({ ...form, baseUrl: e.target.value })} />
            </Field>
          )}
          <Field label="Model" hint={meta.modelHint}>
            <Input required value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} />
          </Field>
          <Field label="API key" hint={meta.keyUrl ? <a className="underline" href={meta.keyUrl} target="_blank" rel="noreferrer">Get an API key</a> : undefined}>
            <Input
              type="password"
              autoComplete="off"
              placeholder={saved.data ? '•••• saved — type to replace' : ''}
              value={form.apiKey === '••••' ? '' : form.apiKey}
              onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
            />
          </Field>
          {test && (
            <div className={`flex gap-2 rounded-lg border p-3 text-sm ${test.ok ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-destructive/30 bg-destructive/5'}`}>
              {test.ok ? <CheckCircle2Icon className="size-4 shrink-0 text-emerald-600" /> : <XCircleIcon className="size-4 shrink-0 text-destructive" />}
              <span className="break-words">{test.ok ? `Connected — replied in ${(test.durationMs / 1000).toFixed(1)} s.` : test.error}</span>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" disabled={runTest.isPending} onClick={() => runTest.mutate()}>
              {runTest.isPending && <Loader2Icon className="animate-spin" />}Test
            </Button>
            <Button type="submit" disabled={save.isPending}>Save</Button>
            {saved.data && <Button type="button" variant="ghost" disabled={remove.isPending} onClick={() => remove.mutate()}>Remove</Button>}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
