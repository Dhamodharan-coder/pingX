import { connect } from 'node:net';
import { connect as tlsConnect } from 'node:tls';
import nodemailer from 'nodemailer';

const PROBES = [
  { host: 'smtp.gmail.com', port: 465 },
  { host: 'smtp.gmail.com', port: 587 },
  { host: 'smtp.office365.com', port: 587 },
  { host: 'smtp-mail.outlook.com', port: 587 },
  { host: 'smtp.zoho.com', port: 465 },
  { host: 'smtp.zoho.com', port: 587 },
  { host: 'smtp.zoho.in', port: 465 },
];
const TIMEOUT_MS = 10_000;

function probe(host: string, port: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const started = performance.now();
    let banner = '';
    const socket =
      port === 465 ? tlsConnect({ host, port, servername: host }) : connect({ host, port });
    socket.setTimeout(TIMEOUT_MS, () => socket.destroy(new Error(`timeout after ${TIMEOUT_MS}ms`)));
    socket.on('data', (chunk) => {
      banner += chunk.toString();
      if (banner.includes('\r\n')) {
        socket.end('QUIT\r\n');
        resolve(`${Math.round(performance.now() - started)}ms ${banner.split('\r\n')[0]}`);
      }
    });
    socket.on('error', reject);
  });
}

async function send(port: number) {
  const { SMTP_HOST, SMTP_USER, SMTP_PASS } = process.env;
  const transport = nodemailer.createTransport({
    host: SMTP_HOST,
    port,
    secure: port === 465,
    requireTLS: port !== 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
    connectionTimeout: TIMEOUT_MS,
    greetingTimeout: TIMEOUT_MS,
    socketTimeout: TIMEOUT_MS,
  });
  const started = performance.now();
  try {
    const info = await transport.sendMail({
      from: SMTP_USER,
      to: process.env.SMTP_TO || SMTP_USER,
      subject: `PingX SMTP egress spike (port ${port})`,
      text: `Sent at ${new Date().toISOString()} via ${SMTP_HOST}:${port}`,
    });
    console.log(`  OK   ${port} ${Math.round(performance.now() - started)}ms ${info.response}`);
  } catch (err) {
    console.log(`  FAIL ${port} ${Math.round(performance.now() - started)}ms`);
    console.dir(err, { depth: null });
  } finally {
    transport.close();
  }
}

console.log('1. TCP/TLS reachability (no auth)');
for (const { host, port } of PROBES) {
  try {
    console.log(`  OK   ${host}:${port} ${await probe(host, port)}`);
  } catch (err) {
    console.log(`  FAIL ${host}:${port} ${(err as Error).message}`);
  }
}

console.log('\n2. Authenticated send via Nodemailer');
if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
  console.log('  skipped: set SMTP_HOST, SMTP_USER, SMTP_PASS (and optionally SMTP_TO) in .env');
} else {
  for (const port of [465, 587]) await send(port);
}
