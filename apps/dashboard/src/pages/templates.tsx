import { EmptyState, ErrorNote, Field, Loading, NativeSelect, PageHeader } from '@/components/common';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { api, errorMessage } from '@/lib/api';
import { fmtDate } from '@/lib/format';
import type { Layout, Template } from '@/lib/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PlusIcon } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

const BLANK_HTML = `<p style="margin:0 0 16px;font-size:18px;font-weight:600;color:#111827">Hi {{name}},</p>
<p style="margin:0 0 16px">Write your message here.</p>
<p style="margin:24px 0"><a href="{{url}}" style="display:inline-block;background:#4f46e5;color:#ffffff;padding:12px 24px;border-radius:6px;font-weight:600;text-decoration:none">Call to action</a></p>`;

const slugify = (s: string) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 63);

export function TemplatesPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: '', slug: '', from: '' });
  const templates = useQuery({ queryKey: ['templates'], queryFn: () => api.get<Template[]>('/templates') });
  const gallery = useQuery({ queryKey: ['gallery'], queryFn: () => api.get<Template[]>('/templates/gallery') });
  const layouts = useQuery({ queryKey: ['layouts'], queryFn: () => api.get<Layout[]>('/layouts') });
  const defaultLayoutId = layouts.data?.find((l) => l.isSystem && l.format === 'html' && l.name === 'Default')?.id;
  const create = useMutation({
    mutationFn: () =>
      api.post<Template>('/templates', {
        name: form.name,
        slug: form.slug,
        ...(form.from ? { fromGalleryId: form.from } : { version: { subject: 'Hello {{name}}', format: 'html', body: BLANK_HTML, sampleData: { name: 'Asha', url: 'https://example.com', brand: 'Acme' } } }),
        layoutId: form.from ? undefined : defaultLayoutId,
      }),
    onSuccess: (t) => {
      qc.invalidateQueries({ queryKey: ['templates'] });
      navigate(`/templates/${t.id}`);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const start = (from = '', name = '') => {
    setForm({ name, slug: slugify(name), from });
    setOpen(true);
  };

  return (
    <>
      <PageHeader
        title="Templates"
        description={<>Reusable emails with <code>{'{{variables}}'}</code>. Send one with <code>{'{ "template": "slug", "data": {…} }'}</code>.</>}
        actions={<Button onClick={() => start()}><PlusIcon />New template</Button>}
      />
      {templates.isLoading ? <Loading /> : templates.error ? <ErrorNote error={templates.error} /> : templates.data?.length ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {templates.data.map((t) => (
            <Link key={t.id} to={`/templates/${t.id}`}>
              <Card className="h-full transition-colors hover:bg-muted/40">
                <CardHeader>
                  <CardTitle>{t.name}</CardTitle>
                  <CardDescription className="font-mono text-xs">{t.slug}</CardDescription>
                </CardHeader>
                <CardContent className="flex items-center justify-between text-xs text-muted-foreground">
                  <span className="truncate">{t.versions[0]?.subject}</span>
                  <Badge variant="outline">v{t.currentVersion}</Badge>
                </CardContent>
                <CardContent className="text-xs text-muted-foreground">Updated {fmtDate(t.updatedAt)}</CardContent>
              </Card>
            </Link>
          ))}
        </div>
      ) : (
        <EmptyState title="No templates yet" description="Start from a gallery template below, or a blank one." />
      )}

      <h2 className="mt-10 mb-3 text-sm font-semibold">Gallery</h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {gallery.data?.map((g) => (
          <Card key={g.id}>
            <CardHeader>
              <CardTitle>{g.name}</CardTitle>
              <CardDescription>{g.description}</CardDescription>
            </CardHeader>
            <CardContent>
              <Button size="sm" variant="outline" onClick={() => start(g.id, g.name)}>Use template</Button>
            </CardContent>
          </Card>
        ))}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>New template</DialogTitle></DialogHeader>
          <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
            <Field label="Name"><Input required autoFocus value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value, slug: slugify(e.target.value) })} /></Field>
            <Field label="Slug" hint="Used in the API: template: &quot;slug&quot;"><Input required pattern="[a-z0-9][a-z0-9\-]*" value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} /></Field>
            <Field label="Start from">
              <NativeSelect value={form.from} onChange={(e) => setForm({ ...form, from: e.target.value })}>
                <option value="">Blank HTML template</option>
                {gallery.data?.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </NativeSelect>
            </Field>
            <DialogFooter><Button type="submit" disabled={create.isPending}>Create</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
