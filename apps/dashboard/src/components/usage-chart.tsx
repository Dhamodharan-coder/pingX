import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { fmtDay, fmtNum } from '@/lib/format';
import type { UsageSeries } from '@/lib/types';
import { cn } from '@/lib/utils';
import { useState } from 'react';

export function StatTile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card>
      <CardContent>
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
        {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}

/** Usage against a limit: hero number + thin meter. The meter turns warning/critical at 80%/100%. */
export function QuotaTile({ label, used, limit }: { label: string; used: number; limit: number }) {
  const pct = limit > 0 ? Math.min(100, (used / limit) * 100) : 0;
  const tone = pct >= 100 ? 'bg-[var(--status-critical)]' : pct >= 80 ? 'bg-[var(--status-warning)]' : 'bg-[var(--series-1)]';
  return (
    <Card className="viz-root">
      <CardContent>
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="mt-1 text-2xl font-semibold tabular-nums">
          {fmtNum(used)} <span className="text-sm font-normal text-muted-foreground">/ {fmtNum(limit)}</span>
        </p>
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted" role="meter" aria-valuemin={0} aria-valuemax={limit} aria-valuenow={used} aria-label={label}>
          <div className={cn('h-full rounded-full transition-all', tone)} style={{ width: `${pct}%` }} />
        </div>
        <p className="mt-1.5 text-xs text-muted-foreground">
          {pct >= 100 ? 'Limit reached — sends return 429' : `${Math.round(pct)}% used`}
        </p>
      </CardContent>
    </Card>
  );
}

const H = 180;
const PAD = { top: 12, right: 8, bottom: 24, left: 36 };

function niceMax(v: number) {
  if (v <= 4) return 4;
  const pow = 10 ** Math.floor(Math.log10(v));
  return Math.ceil(v / pow / 2) * 2 * pow;
}

/** Stacked daily bars: sent (series 1) with failed (series 2) on top, 2px gaps, hover tooltip, table view. */
export function UsageChart({ series }: { series: UsageSeries[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const [asTable, setAsTable] = useState(false);
  const [width, setWidth] = useState(640);
  const max = niceMax(Math.max(0, ...series.map((d) => d.sent + d.failed)));
  const innerW = width - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const slot = innerW / Math.max(1, series.length);
  const barW = Math.max(2, Math.min(18, slot - 4));
  const y = (v: number) => (v / max) * innerH;
  const ticks = [0, max / 2, max];
  const labelEvery = Math.ceil(series.length / 6);
  const hovered = hover !== null ? series[hover] : undefined;

  return (
    <div className="viz-root">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-[var(--series-1)]" />Sent</span>
          <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-[var(--series-2)]" />Failed</span>
        </div>
        <Button variant="ghost" size="xs" onClick={() => setAsTable(!asTable)}>{asTable ? 'Show chart' : 'Show table'}</Button>
      </div>
      {asTable ? (
        <div className="max-h-72 overflow-auto">
          <Table>
            <TableHeader>
              <TableRow><TableHead>Date</TableHead><TableHead className="text-right">Sent</TableHead><TableHead className="text-right">Failed</TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {series.map((d) => (
                <TableRow key={d.date}><TableCell>{fmtDay(d.date)}</TableCell><TableCell className="text-right tabular-nums">{fmtNum(d.sent)}</TableCell><TableCell className="text-right tabular-nums">{fmtNum(d.failed)}</TableCell></TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <div className="relative" ref={(el) => { if (el && Math.abs(el.clientWidth - width) > 1) setWidth(el.clientWidth); }}>
          <svg width={width} height={H} role="img" aria-label="Emails sent and failed per day" onMouseLeave={() => setHover(null)}>
            {ticks.map((t) => (
              <g key={t} transform={`translate(0 ${PAD.top + innerH - y(t)})`}>
                <line x1={PAD.left} x2={width - PAD.right} className="stroke-border" strokeDasharray={t === 0 ? undefined : '2 3'} />
                <text x={PAD.left - 6} dy="0.32em" textAnchor="end" className="fill-muted-foreground text-[10px] tabular-nums">{fmtNum(t)}</text>
              </g>
            ))}
            {series.map((d, i) => {
              const x = PAD.left + i * slot + (slot - barW) / 2;
              const base = PAD.top + innerH;
              const hs = y(d.sent);
              const hf = y(d.failed);
              const gap = hs > 0 && hf > 0 ? 2 : 0;
              const r = Math.min(4, barW / 2);
              return (
                <g key={d.date} opacity={hover === null || hover === i ? 1 : 0.45}>
                  <rect x={PAD.left + i * slot} y={PAD.top} width={slot} height={innerH} fill="transparent" onMouseEnter={() => setHover(i)} />
                  {hs > 0 && <path d={roundedTop(x, base - hs, barW, hs, hf > 0 ? 0 : r)} fill="var(--series-1)" pointerEvents="none" />}
                  {hf > 0 && <path d={roundedTop(x, base - hs - gap - hf, barW, hf, r)} fill="var(--series-2)" pointerEvents="none" />}
                  {i % labelEvery === 0 && (
                    <text x={x + barW / 2} y={H - 6} textAnchor="middle" className="fill-muted-foreground text-[10px]">{fmtDay(d.date)}</text>
                  )}
                </g>
              );
            })}
          </svg>
          {hovered && hover !== null && (
            <div
              className="pointer-events-none absolute top-0 z-10 rounded-lg border bg-popover px-3 py-2 text-xs shadow-md"
              style={{ left: Math.min(width - 140, Math.max(0, PAD.left + hover * slot - 50)) }}
            >
              <p className="font-medium">{fmtDay(hovered.date)}</p>
              <p className="mt-1 flex items-center gap-1.5"><span className="size-2 rounded-sm bg-[var(--series-1)]" />Sent <span className="ml-auto pl-3 tabular-nums">{fmtNum(hovered.sent)}</span></p>
              <p className="flex items-center gap-1.5"><span className="size-2 rounded-sm bg-[var(--series-2)]" />Failed <span className="ml-auto pl-3 tabular-nums">{fmtNum(hovered.failed)}</span></p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function roundedTop(x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, h);
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`;
}
