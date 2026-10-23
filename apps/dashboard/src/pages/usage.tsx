import { ErrorNote, Loading, NativeSelect, PageHeader } from '@/components/common';
import { QuotaTile, StatTile, UsageChart } from '@/components/usage-chart';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { api } from '@/lib/api';
import { fmtNum } from '@/lib/format';
import type { UsageSeries } from '@/lib/types';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

interface Usage {
  series: UsageSeries[];
  today: number;
  month: number;
  aiToday: number;
  limits: { daily: number; monthly: number; burst: number; aiDaily: number };
  plan: { code: string; name: string };
}

export function UsagePage() {
  const [days, setDays] = useState(30);
  const { data, isLoading, error } = useQuery({ queryKey: ['usage', days], queryFn: () => api.get<Usage>(`/usage?days=${days}`) });
  if (isLoading) return <Loading />;
  if (error || !data) return <ErrorNote error={error} />;
  const totalSent = data.series.reduce((a, d) => a + d.sent, 0);
  const totalFailed = data.series.reduce((a, d) => a + d.failed, 0);
  return (
    <>
      <PageHeader
        title="Usage"
        description={`${data.plan.name} plan · limits reset at 00:00 UTC · burst limit ${data.limits.burst}/s`}
        actions={
          <NativeSelect className="w-36" value={days} onChange={(e) => setDays(Number(e.target.value))}>
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
          </NativeSelect>
        }
      />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <QuotaTile label="Today" used={data.today} limit={data.limits.daily} />
        <QuotaTile label="This month" used={data.month} limit={data.limits.monthly} />
        <QuotaTile label="AI drafts today" used={data.aiToday} limit={data.limits.aiDaily} />
        <StatTile label={`Delivered (${days}d)`} value={fmtNum(totalSent)} hint={totalSent + totalFailed ? `${((totalSent / (totalSent + totalFailed)) * 100).toFixed(1)}% success · ${fmtNum(totalFailed)} failed` : undefined} />
      </div>
      <Card className="mt-6">
        <CardHeader><CardTitle>Emails per day</CardTitle></CardHeader>
        <CardContent><UsageChart series={data.series} /></CardContent>
      </Card>
    </>
  );
}
