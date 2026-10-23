# pingx

Official Node.js SDK for PingX — send email through your own providers (Gmail, Outlook, Zoho, any SMTP, Resend, Amazon SES) with automatic fallback.

```bash
npm install pingx
```

Requires Node.js 18+.

## Send an email

```ts
import { PingX } from 'pingx';

const pingx = new PingX({
  apiKey: process.env.PINGX_API_KEY!, // pgx_live_...
  baseUrl: 'https://your-pingx-host/api', // or set PINGX_BASE_URL
});

// With a template you built in the dashboard
const { id, status } = await pingx.send({
  to: 'customer@example.com',
  template: 'welcome',
  data: { name: 'Asha' },
});

// Or raw content
await pingx.send({ to: ['a@example.com'], subject: 'Hello', html: '<p>Hi!</p>', text: 'Hi!' });
```

Options on `send`: `to`, `cc`, `bcc`, `replyTo`, `fromName`, `subject`, `html`, `text`, `template`, `data`, `scheduledAt` (Date or ISO string, up to 30 days ahead), `tags`.

## Batch and status

```ts
const { batchId, messages } = await pingx.sendBatch([{ to: 'a@x.dev', template: 'otp', data: { code: '123456' } }]);
const message = await pingx.getMessage(messages[0].id); // status + delivery events
```

## Errors, retries and idempotency

Every `send` carries an `Idempotency-Key` (random by default, or pass `{ idempotencyKey: 'order-123' }`). Network errors, `5xx` and short `429` bursts are retried with the same key, so a retry never sends twice. Failures throw `PingXError` with `status`, `code` and `retryAfter`:

```ts
import { PingXError } from 'pingx';

try {
  await pingx.send({ to: 'a@x.dev', template: 'welcome' });
} catch (err) {
  if (err instanceof PingXError && err.code === 'daily_limit') {
    console.log(`Quota reached, retry in ${err.retryAfter}s`);
  }
}
```

## Webhooks

```ts
import express from 'express';
import { verifyWebhook } from 'pingx';

app.post('/pingx-webhook', express.raw({ type: 'application/json' }), (req, res) => {
  const event = verifyWebhook(req.body, req.header('pingx-signature'), process.env.PINGX_WEBHOOK_SECRET!);
  if (event.event === 'message.failed') console.warn(event.data.message.error);
  res.sendStatus(200);
});
```

## License

MIT
