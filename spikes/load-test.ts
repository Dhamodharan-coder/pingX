// Usage: PINGX_API_KEY=pgx_live_... pnpm --filter @pingx/spikes load-test -- --rate 50 --seconds 20
const args = Object.fromEntries(process.argv.slice(2).join(' ').split('--').filter(Boolean).map((a) => a.trim().split(/\s+/) as [string, string]));
const rate = Number(args.rate ?? 50);
const seconds = Number(args.seconds ?? 20);
const base = (process.env.PINGX_BASE_URL ?? 'http://localhost:4100').replace(/\/$/, '');
const key = process.env.PINGX_API_KEY;
if (!key) throw new Error('Set PINGX_API_KEY');

const latencies: number[] = [];
const statuses = new Map<number, number>();
const inflight: Promise<void>[] = [];

async function one(i: number) {
  const started = performance.now();
  const res = await fetch(`${base}/v1/send`, {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ to: `load${i}@example.com`, subject: `Load ${i}`, text: 'load test' }),
  }).catch(() => null);
  latencies.push(performance.now() - started);
  const code = res?.status ?? 0;
  statuses.set(code, (statuses.get(code) ?? 0) + 1);
  await res?.text();
}

const total = rate * seconds;
const startedAt = performance.now();
for (let i = 0; i < total; i++) {
  const due = startedAt + (i * 1000) / rate;
  const wait = due - performance.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  inflight.push(one(i));
}
await Promise.all(inflight);

const elapsed = (performance.now() - startedAt) / 1000;
latencies.sort((a, b) => a - b);
const pct = (p: number) => latencies[Math.min(latencies.length - 1, Math.floor((p / 100) * latencies.length))]!.toFixed(1);
console.log(`${total} requests in ${elapsed.toFixed(1)}s (${(total / elapsed).toFixed(1)} req/s target ${rate})`);
console.log('status codes:', Object.fromEntries([...statuses].sort()));
console.log(`latency ms  p50 ${pct(50)}  p95 ${pct(95)}  p99 ${pct(99)}  max ${latencies.at(-1)!.toFixed(1)}`);

export {};
