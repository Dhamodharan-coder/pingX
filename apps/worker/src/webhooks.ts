import { prisma } from '@pingx/db';
import { decrypt, hmacSha256, type Keyring, type WebhookJob } from '@pingx/shared';

/** Signature header: `t=<unix>,v1=<hex hmac-sha256(secret, "<t>.<body>")>`. */
export async function deliverWebhook(keyring: Keyring, job: WebhookJob) {
  const hook = await prisma.webhook.findUnique({ where: { id: job.webhookId } });
  if (!hook || !hook.active) return;
  const body = JSON.stringify({ event: job.event, createdAt: new Date().toISOString(), data: job.payload });
  const t = Math.floor(Date.now() / 1000);
  const secret = decrypt(keyring, hook.secretEnc, hook.keyVersion);
  const res = await fetch(hook.url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'user-agent': 'PingX-Webhooks/1.0',
      'pingx-event': job.event,
      'pingx-signature': `t=${t},v1=${hmacSha256(secret, `${t}.${body}`)}`,
    },
    body,
    redirect: 'manual',
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Webhook responded ${res.status}`);
}
