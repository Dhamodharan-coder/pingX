import { ProviderError } from '@pingx/channels';
import { describe, expect, it } from 'vitest';
import { orderChain, runChain, type ChainEvent } from './chain';

const p = (id: string, priority: number, healthy = true) => ({ id, priority, healthy });

describe('orderChain', () => {
  it('orders healthy providers by priority', () => {
    expect(orderChain([p('c', 3), p('a', 1), p('b', 2, false)]).map((x) => x.id)).toEqual(['a', 'c']);
  });
  it('moves the project default to the front', () => {
    expect(orderChain([p('a', 1), p('b', 2), p('c', 3)], 'c').map((x) => x.id)).toEqual(['c', 'a', 'b']);
  });
  it('ignores an unhealthy default', () => {
    expect(orderChain([p('a', 1), p('b', 2, false)], 'b').map((x) => x.id)).toEqual(['a']);
  });
});

describe('runChain', () => {
  const providers = [p('a', 1), p('b', 2), p('c', 3)];

  async function run(behaviour: Record<string, () => Promise<{ providerMessageId?: string }>>, skip: Record<string, string> = {}) {
    const events: ChainEvent<ReturnType<typeof p>>[] = [];
    const result = await runChain(providers, {
      skipReason: async (x) => skip[x.id] ?? null,
      send: (x) => behaviour[x.id]!(),
      onEvent: async (e) => {
        events.push(e);
      },
    });
    return { result, events: events.map((e) => `${e.type}:${e.provider.id}`) };
  }

  it('stops at the first success', async () => {
    const { result, events } = await run({ a: async () => ({ providerMessageId: '1' }), b: async () => ({}), c: async () => ({}) });
    expect(result.status).toBe('sent');
    expect(events).toEqual(['attempt:a']);
  });

  it('falls back on provider-side errors', async () => {
    const { result, events } = await run({
      a: async () => { throw new ProviderError('provider', 'auth', { auth: true }); },
      b: async () => { throw new ProviderError('provider', 'timeout'); },
      c: async () => ({ providerMessageId: 'ok' }),
    });
    expect(result).toMatchObject({ status: 'sent', provider: { id: 'c' } });
    expect(events).toEqual(['attempt:a', 'provider_error:a', 'attempt:b', 'provider_error:b', 'attempt:c']);
  });

  it('never falls back on recipient errors', async () => {
    const { result, events } = await run({
      a: async () => { throw new ProviderError('recipient', '550 5.1.1 no such user'); },
      b: async () => ({}),
      c: async () => ({}),
    });
    expect(result.status).toBe('recipient_error');
    expect(events).toEqual(['attempt:a']);
  });

  it('treats unknown errors as provider-side', async () => {
    const { result } = await run({
      a: async () => { throw new Error('boom'); },
      b: async () => ({ providerMessageId: 'x' }),
      c: async () => ({}),
    });
    expect(result).toMatchObject({ status: 'sent', provider: { id: 'b' } });
  });

  it('skips capped providers and reports exhaustion', async () => {
    const fail = async () => { throw new ProviderError('provider', '503'); };
    const { result, events } = await run({ a: fail, b: fail, c: fail }, { a: 'daily cap reached' });
    expect(result).toMatchObject({ status: 'exhausted', skipped: 1 });
    expect(events[0]).toBe('skipped:a');
  });
});
