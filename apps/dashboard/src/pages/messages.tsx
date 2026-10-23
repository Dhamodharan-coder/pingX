import { EmptyState, ErrorNote, Loading, NativeSelect, PageHeader, StatusBadge } from '@/components/common';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { api } from '@/lib/api';
import { fmtDate, providerLabel } from '@/lib/format';
import type { MessageDetail, MessageRow, Page, Project } from '@/lib/types';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { ArrowLeftIcon } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

export function MessageTable({ basePath, endpoint, showUser }: { basePath: string; endpoint: string; showUser?: boolean }) {
  const navigate = useNavigate();
  const [status, setStatus] = useState('');
  const [projectId, setProjectId] = useState('');
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const projects = useQuery({ queryKey: ['projects'], queryFn: () => api.get<Project[]>('/projects'), enabled: !showUser });
  const params = new URLSearchParams({ ...(status && { status }), ...(projectId && { projectId }), ...(search && { q: search }) });
  const list = useInfiniteQuery({
    queryKey: [endpoint, status, projectId, search],
    initialPageParam: '',
    queryFn: ({ pageParam }) => api.get<Page<MessageRow>>(`${endpoint}?${params}${pageParam ? `&cursor=${pageParam}` : ''}`),
    getNextPageParam: (p) => p.nextCursor ?? undefined,
    refetchInterval: 10_000,
  });
  const rows = list.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <>
      <div className="mb-4 flex flex-wrap gap-2">
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); setSearch(q); }}>
          <Input placeholder="Search recipient, subject or id" value={q} onChange={(e) => setQ(e.target.value)} className="w-64" />
          <Button type="submit" variant="outline">Search</Button>
        </form>
        <NativeSelect className="w-36" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          {['sent', 'failed', 'queued', 'sending', 'scheduled'].map((s) => <option key={s} value={s}>{s}</option>)}
        </NativeSelect>
        {!showUser && (
          <NativeSelect className="w-44" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            <option value="">All projects</option>
            {projects.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </NativeSelect>
        )}
      </div>
      {list.isLoading ? <Loading /> : list.error ? <ErrorNote error={list.error} /> : rows.length === 0 ? (
        <EmptyState title="No messages" description="Messages you send through the API show up here." />
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Status</TableHead>
                <TableHead>To</TableHead>
                <TableHead>Subject</TableHead>
                {showUser && <TableHead>User</TableHead>}
                <TableHead>Provider</TableHead>
                <TableHead>Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((m) => (
                <TableRow key={m.id} className="cursor-pointer" onClick={() => navigate(`${basePath}/${m.id}`)}>
                  <TableCell><StatusBadge status={m.status} /></TableCell>
                  <TableCell className="max-w-48 truncate">{m.to.join(', ')}</TableCell>
                  <TableCell className="max-w-64 truncate">{m.subject}</TableCell>
                  {showUser && <TableCell className="text-muted-foreground">{m.user?.email}</TableCell>}
                  <TableCell className="text-muted-foreground">{m.provider?.name ?? '—'}</TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">{fmtDate(m.createdAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
      {list.hasNextPage && (
        <div className="mt-4 flex justify-center">
          <Button variant="outline" disabled={list.isFetchingNextPage} onClick={() => list.fetchNextPage()}>Load more</Button>
        </div>
      )}
    </>
  );
}

export function MessagesPage() {
  return (
    <>
      <PageHeader title="Messages" description="Every email sent through PingX, with delivery attempts and fallbacks." />
      <MessageTable basePath="/messages" endpoint="/messages" />
    </>
  );
}

export function MessageDetailView({ endpoint, back }: { endpoint: string; back: string }) {
  const { id } = useParams<{ id: string }>();
  const [view, setView] = useState<'html' | 'text'>('html');
  const { data: m, isLoading, error } = useQuery({
    queryKey: [endpoint, id],
    queryFn: () => api.get<MessageDetail>(`${endpoint}/${id}`),
    refetchInterval: (q) => (q.state.data && ['queued', 'sending', 'scheduled'].includes(q.state.data.status) ? 3000 : false),
  });
  if (isLoading) return <Loading />;
  if (error || !m) return <ErrorNote error={error} />;
  return (
    <>
      <Link to={back} className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeftIcon className="size-4" />Messages</Link>
      <PageHeader title={m.subject} description={<span className="font-mono text-xs">{m.id}</span>} actions={<StatusBadge status={m.status} />} />
      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <Card className="min-h-[480px] overflow-hidden">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Content</CardTitle>
            <Tabs value={view} onValueChange={(v) => setView(v as 'html' | 'text')}>
              <TabsList><TabsTrigger value="html">HTML</TabsTrigger><TabsTrigger value="text">Text</TabsTrigger></TabsList>
            </Tabs>
          </CardHeader>
          {view === 'html' ? (
            <iframe title="Message HTML" sandbox="" srcDoc={m.html} className="h-[520px] w-full bg-white" />
          ) : (
            <CardContent><pre className="text-sm whitespace-pre-wrap">{m.text ?? '(no text part)'}</pre></CardContent>
          )}
        </Card>
        <div className="grid content-start gap-6">
          <Card>
            <CardHeader><CardTitle>Details</CardTitle></CardHeader>
            <CardContent className="grid gap-2 text-sm">
              {[
                ['To', m.to.join(', ')],
                ['Cc', m.cc.join(', ') || '—'],
                ['Provider', m.provider ? `${m.provider.name} (${providerLabel[m.provider.type]})` : '—'],
                ['Template', m.template ? m.template.slug : '—'],
                ['Attempts', String(m.attempts)],
                ['Scheduled', fmtDate(m.scheduledAt)],
                ['Sent', fmtDate(m.sentAt)],
                ['Provider id', m.providerMessageId ?? '—'],
              ].map(([k, v]) => (
                <div key={k} className="grid grid-cols-[90px_1fr] gap-2">
                  <span className="text-muted-foreground">{k}</span>
                  <span className="break-all">{v}</span>
                </div>
              ))}
              {m.error && <p className="mt-2 rounded-lg bg-destructive/5 p-2 text-xs break-words text-destructive">{m.error}</p>}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Timeline</CardTitle></CardHeader>
            <CardContent>
              <ol className="relative grid gap-4 border-l pl-4">
                {m.events.map((e) => (
                  <li key={e.id} className="text-sm">
                    <span className="absolute -left-1.5 mt-1.5 size-3 rounded-full border-2 border-background bg-muted-foreground" />
                    <p className="font-medium capitalize">{e.type}</p>
                    {e.detail && <p className="text-xs break-words text-muted-foreground">{e.detail}</p>}
                    <p className="text-xs text-muted-foreground">{fmtDate(e.createdAt)}</p>
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}

export const MessageDetailPage = () => <MessageDetailView endpoint="/messages" back="/messages" />;
