// Usage: pnpm email:test you@example.com — sends one system email directly with the .env settings.
import { pickSystemEmailTransport } from '@pingx/shared';
import { env } from './env';
import { sendSystemEmail } from './system';

const to = process.argv.slice(2).find((a) => a.includes('@'));
if (!to) {
  console.error('Usage: pnpm email:test you@example.com');
  process.exit(1);
}

console.log(`EMAIL_ENABLED=${env.EMAIL_ENABLED} transport=${pickSystemEmailTransport(env)} from="${env.EMAIL_FROM}"${env.SMTP_HOST ? ` smtp=${env.SMTP_HOST}:${env.SMTP_PORT} secure=${env.SMTP_SECURE}` : ''}`);
if (!env.EMAIL_ENABLED) console.log('Note: EMAIL_ENABLED is not "true", so nothing is really sent.');

const started = Date.now();
try {
  await sendSystemEmail({
    to,
    subject: 'PingX email test',
    html: `<p>This is a test of PingX system email, sent ${new Date().toISOString()}.</p><p>If you can read this, verification and password-reset emails will work.</p>`,
  });
  console.log(`OK in ${Date.now() - started} ms`);
  process.exit(0);
} catch (err) {
  console.error(`FAILED after ${Date.now() - started} ms`);
  console.dir(err, { depth: null });
  process.exit(1);
}
