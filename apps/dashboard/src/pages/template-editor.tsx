import { ConfirmDialog, ErrorNote, Field, Loading, NativeSelect } from '@/components/common';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { fmtDate } from '@/lib/format';
import type { Layout, Project, Template, TemplateVersion } from '@/lib/types';
import Editor from '@monaco-editor/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeftIcon, HistoryIcon, Loader2Icon, PencilIcon, SendIcon, SparklesIcon, Trash2Icon } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';

interface Draft {
  subject: string;
  format: 'mjml' | 'html';
  body: string;
  sampleData: string;
  layoutId: string;
}

function useDebounced<T>(value: T, ms: number) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

const slugify = (s: string) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 63);

const parseJson = (s: string): Record<string, unknown> | null => {
  try {
    const v = JSON.parse(s || '{}');
    return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
};

export function TemplateEditorPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { user } = useAuth();
  const template = useQuery({ queryKey: ['template', id], queryFn: () => api.get<Template>(`/templates/${id}`) });
  const layouts = useQuery({ queryKey: ['layouts'], queryFn: () => api.get<Layout[]>('/layouts') });
  const projects = useQuery({ queryKey: ['projects'], queryFn: () => api.get<Project[]>('/projects') });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [tab, setTab] = useState<'body' | 'data'>('body');
  const [aiOpen, setAiOpen] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [testOpen, setTestOpen] = useState(false);
  const [testTo, setTestTo] = useState('');
  const [testProject, setTestProject] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [renaming, setRenaming] = useState<{ name: string; slug: string; slugEdited: boolean } | null>(null);

  const current: TemplateVersion | undefined = template.data?.versions[0];
  useEffect(() => {
    if (template.data && current && !draft) {
      setDraft({
        subject: current.subject,
        format: current.format,
        body: current.body,
        sampleData: JSON.stringify(current.sampleData ?? {}, null, 2),
        layoutId: template.data.layoutId ?? '',
      });
    }
  }, [template.data, current, draft]);

  const dirty = useMemo(() => {
    if (!draft || !current || !template.data) return false;
    return (
      draft.subject !== current.subject ||
      draft.body !== current.body ||
      draft.format !== current.format ||
      draft.layoutId !== (template.data.layoutId ?? '') ||
      JSON.stringify(parseJson(draft.sampleData)) !== JSON.stringify(current.sampleData ?? {})
    );
  }, [draft, current, template.data]);

  const debounced = useDebounced(draft, 400);
  const preview = useQuery({
    queryKey: ['preview', debounced],
    enabled: !!debounced,
    placeholderData: (prev) => prev,
    retry: false,
    queryFn: () =>
      api.post<{ subject: string; html: string; text: string }>('/templates/preview', {
        subject: debounced!.subject,
        format: debounced!.format,
        body: debounced!.body,
        layoutId: debounced!.layoutId || null,
        data: parseJson(debounced!.sampleData) ?? {},
      }),
  });

  const save = useMutation({
    mutationFn: () =>
      api.put<Template>(`/templates/${id}`, {
        layoutId: draft!.layoutId || null,
        version: { subject: draft!.subject, format: 'html', body: draft!.body, sampleData: parseJson(draft!.sampleData) },
      }),
    onSuccess: (t) => {
      qc.invalidateQueries({ queryKey: ['template', id] });
      qc.invalidateQueries({ queryKey: ['templates'] });
      toast.success(`Saved as version ${t.currentVersion}`);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const rename = useMutation({
    mutationFn: (v: { name: string; slug: string }) => api.put<Template>(`/templates/${id}`, v),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['template', id] });
      qc.invalidateQueries({ queryKey: ['templates'] });
      setRenaming(null);
      toast.success('Template renamed');
      qc.invalidateQueries({ queryKey: ['templates'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const convert = useMutation({
    mutationFn: () => api.post<Template>(`/templates/${id}/convert-html`),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['template', id] });
      setDraft(null);
      toast.success('Converted to HTML — saved as a new version');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const rollback = useMutation({
    mutationFn: (version: number) => api.post<Template>(`/templates/${id}/rollback`, { version }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['template', id] });
      setDraft(null);
      setHistoryOpen(false);
      toast.success('Restored');
    },
  });
  const ai = useMutation({
    mutationFn: () =>
      api.post<{ subject: string; body: string; sampleData: Record<string, string> }>('/templates/ai', {
        prompt: aiPrompt,
        current: draft ? { subject: draft.subject, body: draft.body } : undefined,
      }),
    onSuccess: (r) => {
      setDraft((d) =>
        d
          ? {
              ...d,
              subject: r.subject,
              body: r.body,
              format: 'html',
              // The AI returns a full HTML document, so it doesn't go inside a layout.
              layoutId: '',
              sampleData: JSON.stringify({ ...(parseJson(d.sampleData) ?? {}), ...r.sampleData }, null, 2),
            }
          : d,
      );
      setAiOpen(false);
      setAiPrompt('');
      toast.success('Draft updated — review and save');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const testSend = useMutation({
    mutationFn: () => api.post<{ id: string }>(`/templates/${id}/test-send`, { projectId: testProject || projects.data?.[0]?.id, to: testTo || undefined, data: parseJson(draft!.sampleData) ?? {} }),
    onSuccess: (r) => {
      setTestOpen(false);
      toast.success('Test email queued', { action: { label: 'View', onClick: () => navigate(`/messages/${r.id}`) } });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: () => api.del(`/templates/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['templates'] });
      navigate('/templates');
    },
  });

  if (template.isLoading || !draft) return template.error ? <ErrorNote error={template.error} /> : <Loading />;
  const t = template.data!;
  const sampleOk = parseJson(draft.sampleData) !== null;
  const legacy = draft.format === 'mjml';

  return (
    <div className="flex h-full flex-col overflow-y-auto lg:overflow-hidden">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-4 py-2.5">
        <Link to="/templates" className="text-muted-foreground hover:text-foreground"><ArrowLeftIcon className="size-4" /></Link>
        <h1 className="font-semibold">{t.name}</h1>
        <Button size="icon-xs" variant="ghost" onClick={() => setRenaming({ name: t.name, slug: t.slug, slugEdited: false })} aria-label="Rename template"><PencilIcon /></Button>
        <Badge variant="outline" className="font-mono" title="Slug used in the API: template: &quot;slug&quot;">{t.slug}</Badge>
        <Badge variant="outline">v{t.currentVersion}</Badge>
        {dirty && <Badge>Unsaved</Badge>}
        <div className="ml-auto flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => setAiOpen(true)}><SparklesIcon />AI assist</Button>
          <Button size="sm" variant="outline" onClick={() => setHistoryOpen(true)}><HistoryIcon />History</Button>
          <Button size="sm" variant="outline" onClick={() => { setTestTo(user?.email ?? ''); setTestOpen(true); }}><SendIcon />Test send</Button>
          <Button size="icon-sm" variant="ghost" onClick={() => setConfirmDelete(true)} aria-label="Delete template"><Trash2Icon /></Button>
          <Button size="sm" disabled={!dirty || save.isPending || !sampleOk || legacy} onClick={() => save.mutate()}>
            {save.isPending && <Loader2Icon className="animate-spin" />}Save
          </Button>
        </div>
      </div>
      {legacy && (
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b bg-amber-500/10 px-4 py-2 text-sm text-amber-800 dark:text-amber-300">
          <span>This template uses the old MJML format. Convert it to HTML + Handlebars to keep editing — your {'{{variables}}'} are kept.</span>
          <Button size="xs" variant="outline" disabled={convert.isPending} onClick={() => convert.mutate()}>
            {convert.isPending && <Loader2Icon className="animate-spin" />}Convert to HTML
          </Button>
        </div>
      )}
      <div className="grid shrink-0 gap-3 border-b px-4 py-3 sm:grid-cols-[1fr_220px]">
        <Field label="Subject"><Input value={draft.subject} onChange={(e) => setDraft({ ...draft, subject: e.target.value })} /></Field>
        <Field
          label="Layout"
          hint={
            draft.layoutId && /<html[\s>]/i.test(draft.body) ? (
              <span className="text-amber-700 dark:text-amber-400">This body is a full HTML document — choose “No layout” to avoid wrapping it twice.</span>
            ) : undefined
          }
        >
          <NativeSelect value={draft.layoutId} onChange={(e) => setDraft({ ...draft, layoutId: e.target.value })}>
            <option value="">No layout</option>
            {layouts.data?.filter((l) => l.format === draft.format).map((l) => <option key={l.id} value={l.id}>{l.name}{l.isSystem ? ' (system)' : ''}</option>)}
          </NativeSelect>
        </Field>
      </div>
      <div className="grid min-h-0 flex-1 lg:grid-cols-2 lg:grid-rows-[minmax(0,1fr)]">
        <div className="flex min-h-[420px] flex-col border-r lg:min-h-0">
          <div className="flex items-center justify-between px-3 py-2">
            <Tabs value={tab} onValueChange={(v) => setTab(v as 'body' | 'data')}>
              <TabsList>
                <TabsTrigger value="body">Body</TabsTrigger>
                <TabsTrigger value="data">Sample data {!sampleOk && '⚠'}</TabsTrigger>
              </TabsList>
            </Tabs>
            <span className="text-xs text-muted-foreground">HTML + Handlebars: {'{{variable}}'}, {'{{#each items}}…{{/each}}'}, {'{{#if x}}…{{/if}}'}</span>
          </div>
          <div className="min-h-0 flex-1">
            <Editor
              key={tab}
              language={tab === 'data' ? 'json' : 'html'}
              value={tab === 'body' ? draft.body : draft.sampleData}
              onChange={(v) => setDraft((d) => (d ? (tab === 'body' ? { ...d, body: v ?? '' } : { ...d, sampleData: v ?? '' }) : d))}
              options={{ minimap: { enabled: false }, fontSize: 13, wordWrap: 'on', scrollBeyondLastLine: false, tabSize: 2 }}
              theme={document.documentElement.classList.contains('dark') ? 'vs-dark' : 'light'}
            />
          </div>
        </div>
        <div className="flex min-h-[420px] flex-col bg-muted/30 lg:min-h-0">
          <div className="flex items-center gap-2 border-b px-3 py-2 text-sm">
            <span className="text-muted-foreground">Preview:</span>
            <span className="truncate font-medium">{preview.data?.subject}</span>
            {preview.isFetching && <Loader2Icon className="size-3.5 animate-spin text-muted-foreground" />}
          </div>
          {preview.error ? (
            <div className="p-4"><ErrorNote error={preview.error} /></div>
          ) : (
            <iframe title="Email preview" sandbox="" className="min-h-0 w-full flex-1 bg-white" srcDoc={preview.data?.html ?? ''} />
          )}
        </div>
      </div>

      <Dialog open={aiOpen} onOpenChange={setAiOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>AI template assistant</DialogTitle>
            <DialogDescription>
              Describe the email, or how to change the current one. You get an email-safe HTML template with Handlebars {'{{variables}}'}. Uses the AI provider and key from{' '}
              <Link to="/settings" className="underline">Settings → AI assistant</Link>.
            </DialogDescription>
          </DialogHeader>
          <Textarea rows={5} value={aiPrompt} onChange={(e) => setAiPrompt(e.target.value)} placeholder="An order confirmation with order number, item list and a track-order button" />
          <p className="text-xs text-muted-foreground">
            Templates use Handlebars: <code>{'{{name}}'}</code> for values and <code>{'{{#each items}}…{{/each}}'}</code> for lists.
          </p>
          <DialogFooter>
            <Button disabled={aiPrompt.trim().length < 3 || ai.isPending} onClick={() => ai.mutate()}>
              {ai.isPending ? <Loader2Icon className="animate-spin" /> : <SparklesIcon />}Generate
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={renaming !== null} onOpenChange={(o) => !o && setRenaming(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Rename template</DialogTitle></DialogHeader>
          {renaming && (
            <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); rename.mutate({ name: renaming.name.trim(), slug: renaming.slug }); }}>
              <Field label="Name">
                <Input
                  autoFocus
                  required
                  maxLength={100}
                  value={renaming.name}
                  onChange={(e) => setRenaming({ ...renaming, name: e.target.value, slug: renaming.slugEdited ? renaming.slug : slugify(e.target.value) })}
                />
              </Field>
              <Field label="Slug" hint={<>Used by the API: <code>{`"template": "${renaming.slug || '…'}"`}</code>. Must be unique among your templates.</>}>
                <Input
                  required
                  pattern="[a-z0-9][a-z0-9\-]*"
                  maxLength={63}
                  className="font-mono"
                  value={renaming.slug}
                  onChange={(e) => setRenaming({ ...renaming, slug: e.target.value.toLowerCase(), slugEdited: true })}
                />
              </Field>
              {renaming.slug !== t.slug && (
                <p className="rounded-lg bg-amber-500/10 p-2.5 text-xs text-amber-800 dark:text-amber-300">
                  Apps that send with <code>"template": "{t.slug}"</code> will stop working until you update them to the new slug.
                </p>
              )}
              <DialogFooter>
                <Button type="submit" disabled={!renaming.name.trim() || !renaming.slug || rename.isPending}>Save</Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Version history</DialogTitle></DialogHeader>
          <div className="-mx-1 flex max-h-96 min-w-0 flex-col gap-2 overflow-x-hidden overflow-y-auto px-1">
            {t.versions.map((v) => {
              const current = v.version === t.currentVersion;
              return (
                <div key={v.id} className={`flex min-w-0 items-center gap-3 rounded-lg border p-3 text-sm ${current ? 'bg-muted/50' : ''}`}>
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 font-medium">
                      v{v.version}
                      {current && <Badge variant="secondary">Current</Badge>}
                    </p>
                    <p className="truncate text-xs text-muted-foreground" title={v.subject}>{v.subject}</p>
                    <p className="text-xs text-muted-foreground">{fmtDate(v.createdAt)}</p>
                  </div>
                  {!current && (
                    <Button size="xs" variant="outline" className="shrink-0" disabled={rollback.isPending} onClick={() => rollback.mutate(v.version)}>
                      Restore
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
          <p className="text-xs text-muted-foreground">Restoring copies that version into a new version, so nothing is lost.</p>
        </DialogContent>
      </Dialog>

      <Dialog open={testOpen} onOpenChange={setTestOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Send a test</DialogTitle>
            <DialogDescription>Sends the saved version with the current sample data through your providers. Counts toward your quota.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <Field label="To"><Input type="email" value={testTo} onChange={(e) => setTestTo(e.target.value)} /></Field>
            <Field label="Project">
              <NativeSelect value={testProject} onChange={(e) => setTestProject(e.target.value)}>
                {projects.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </NativeSelect>
            </Field>
            {!projects.data?.length && <p className="text-sm text-destructive">Create a project first.</p>}
            {dirty && <p className="text-sm text-amber-700 dark:text-amber-400">You have unsaved changes; the test uses the saved version.</p>}
          </div>
          <DialogFooter>
            <Button disabled={!projects.data?.length || testSend.isPending} onClick={() => testSend.mutate()}>Send test</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog open={confirmDelete} onOpenChange={setConfirmDelete} title={`Delete ${t.name}?`} description="API calls using this slug will start failing." onConfirm={() => remove.mutate()} pending={remove.isPending} />
    </div>
  );
}
