import { ProviderError, type SendResult } from '@pingx/channels';

export interface ChainProvider {
  id: string;
  priority: number;
  healthy: boolean;
}

/** Healthy providers by priority, with the project's default (if healthy) moved to the front. */
export function orderChain<T extends ChainProvider>(providers: T[], defaultProviderId?: string | null): T[] {
  const healthy = providers.filter((p) => p.healthy).sort((a, b) => a.priority - b.priority);
  const i = healthy.findIndex((p) => p.id === defaultProviderId);
  if (i > 0) healthy.unshift(...healthy.splice(i, 1));
  return healthy;
}

export type ChainEvent<T> =
  | { type: 'skipped'; provider: T; reason: string }
  | { type: 'attempt'; provider: T }
  | { type: 'provider_error'; provider: T; error: ProviderError };

export type ChainResult<T> =
  | { status: 'sent'; provider: T; result: SendResult }
  | { status: 'recipient_error'; provider: T; error: ProviderError }
  | { status: 'exhausted'; errors: ProviderError[]; skipped: number };

/**
 * Tries providers in order. Provider-side errors fall through to the next provider;
 * a recipient-side error stops the chain because another provider would fail the same way.
 */
export async function runChain<T>(
  providers: T[],
  deps: {
    skipReason: (p: T) => Promise<string | null>;
    send: (p: T) => Promise<SendResult>;
    onEvent: (e: ChainEvent<T>) => Promise<void>;
  },
): Promise<ChainResult<T>> {
  const errors: ProviderError[] = [];
  let skipped = 0;
  for (const provider of providers) {
    const reason = await deps.skipReason(provider);
    if (reason) {
      skipped++;
      await deps.onEvent({ type: 'skipped', provider, reason });
      continue;
    }
    await deps.onEvent({ type: 'attempt', provider });
    try {
      return { status: 'sent', provider, result: await deps.send(provider) };
    } catch (err) {
      const error = err instanceof ProviderError ? err : new ProviderError('provider', (err as Error).message ?? String(err));
      if (error.side === 'recipient') return { status: 'recipient_error', provider, error };
      errors.push(error);
      await deps.onEvent({ type: 'provider_error', provider, error });
    }
  }
  return { status: 'exhausted', errors, skipped };
}
