import { Code, PageHeader } from '@/components/common';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

const API = `${window.location.origin}/api`;

export function DocsPage() {
  return (
    <>
      <PageHeader title="Quickstart" description="Send your first email in two minutes." />
      <div className="grid max-w-3xl gap-6">
        <Card>
          <CardHeader><CardTitle>1. Install the SDK</CardTitle></CardHeader>
          <CardContent><Code>npm install pingx-mail</Code></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>2. Send with a template</CardTitle></CardHeader>
          <CardContent className="grid gap-3">
            <Code>{`import { PingX } from 'pingx-mail';

const pingx = new PingX({ apiKey: process.env.PINGX_API_KEY!, baseUrl: '${API}' });

const { id } = await pingx.send({
  to: 'customer@example.com',
  template: 'welcome',
  data: { name: 'Asha' },
});`}</Code>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Or call the REST API</CardTitle></CardHeader>
          <CardContent className="grid gap-3 text-sm">
            <Code>{`curl -X POST ${API}/v1/send \\
  -H "Authorization: Bearer pgx_live_..." \\
  -H "Content-Type: application/json" \\
  -H "Idempotency-Key: order-1234" \\
  -d '{"to":"customer@example.com","subject":"Hello","html":"<p>Hi!</p>"}'`}</Code>
            <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
              <li><code>POST /v1/send</code> → <code>202 {'{ id, status }'}</code>. Fields: <code>to, cc, bcc, replyTo, fromName, subject, html, text, template, data, scheduledAt, tags</code>.</li>
              <li><code>POST /v1/send/batch</code> with <code>{'{ messages: [...] }'}</code> (up to 100).</li>
              <li><code>GET /v1/messages/:id</code> for status and delivery events.</li>
              <li>Over quota → <code>429</code> with <code>X-RateLimit-Limit</code>, <code>X-RateLimit-Remaining</code>, <code>X-RateLimit-Reset</code>, <code>Retry-After</code>.</li>
              <li>Send the same <code>Idempotency-Key</code> to safely retry without sending twice.</li>
            </ul>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Verify webhooks</CardTitle></CardHeader>
          <CardContent>
            <Code>{`import { verifyWebhook } from 'pingx-mail';

const event = verifyWebhook(rawBody, req.headers['pingx-signature'], process.env.PINGX_WEBHOOK_SECRET!);
// event.event === 'message.sent' | 'message.failed'`}</Code>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
