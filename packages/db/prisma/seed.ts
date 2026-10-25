import { hash } from '@node-rs/argon2';
import { prisma } from '../src/index';

const plans = [
  { code: 'free', name: 'Free', dailyLimit: 200, monthlyLimit: 6000, burstPerSecond: 5, aiDailyLimit: 5, priceInr: 0, sortOrder: 0 },
  { code: 'starter', name: 'Starter', dailyLimit: 2000, monthlyLimit: 60000, burstPerSecond: 10, aiDailyLimit: 25, priceInr: 199, sortOrder: 1 },
  { code: 'pro', name: 'Pro', dailyLimit: 10000, monthlyLimit: 300000, burstPerSecond: 50, aiDailyLimit: 100, priceInr: 699, sortOrder: 2 },
];

const presets = [
  { name: 'Gmail (SMTP app password)', type: 'smtp', host: 'smtp.gmail.com', port: 465, secure: true, dailyCap: 500, helpUrl: 'https://myaccount.google.com/apppasswords', sortOrder: 0 },
  { name: 'Gmail (Sign in with Google)', type: 'gmail_oauth', dailyCap: 500, sortOrder: 1 },
  { name: 'Outlook / Microsoft 365', type: 'smtp', host: 'smtp.office365.com', port: 587, secure: false, dailyCap: 300, sortOrder: 2 },
  { name: 'Zoho Mail', type: 'smtp', host: 'smtp.zoho.com', port: 465, secure: true, sortOrder: 3 },
  { name: 'Zoho Mail (India)', type: 'smtp', host: 'smtp.zoho.in', port: 465, secure: true, sortOrder: 4 },
  { name: 'Resend', type: 'resend', helpUrl: 'https://resend.com/api-keys', sortOrder: 5 },
  { name: 'Amazon SES', type: 'ses', helpUrl: 'https://console.aws.amazon.com/ses', sortOrder: 6 },
  { name: 'Custom SMTP', type: 'smtp', sortOrder: 7 },
] as const;

// Templates are HTML + Handlebars. The layout wraps a template body via {{{content}}}.
const systemLayout = `<!doctype html>
<html>
<body style="margin:0;padding:0;background:#f4f4f5">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5">
  <tr><td align="center" style="padding:24px 12px">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:8px;font-family:Arial,Helvetica,sans-serif">
      <tr><td style="padding:24px 32px 0;font-size:20px;font-weight:700;color:#111827">{{brand}}</td></tr>
      <tr><td style="padding:16px 32px 32px;font-size:15px;line-height:24px;color:#374151">{{{content}}}</td></tr>
    </table>
    <p style="margin:16px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#71717a">Sent with PingX</p>
  </td></tr>
</table>
</body>
</html>`;

const button = (href: string, label: string) =>
  `<p style="margin:24px 0"><a href="${href}" style="display:inline-block;background:#4f46e5;color:#ffffff;padding:12px 24px;border-radius:6px;font-weight:600;text-decoration:none">${label}</a></p>`;

const gallery = [
  {
    slug: 'welcome',
    name: 'Welcome',
    description: 'Greet a new user after signup',
    subject: 'Welcome to {{appName}}, {{name}}!',
    body: `<p style="margin:0 0 16px;font-size:18px;font-weight:600;color:#111827">Hi {{name}},</p>
<p style="margin:0 0 16px">Thanks for joining {{appName}}. We're glad to have you.</p>
${button('{{ctaUrl}}', 'Get started')}`,
    sampleData: { name: 'Asha', appName: 'Acme', ctaUrl: 'https://example.com', brand: 'Acme' },
  },
  {
    slug: 'otp',
    name: 'One-time code',
    description: 'Send a login or verification code',
    subject: 'Your {{appName}} code: {{code}}',
    body: `<p style="margin:0 0 16px">Use this code to continue:</p>
<p style="margin:16px 0;text-align:center;font-size:32px;font-weight:700;letter-spacing:6px;color:#111827">{{code}}</p>
<p style="margin:0;font-size:13px;color:#71717a">It expires in {{minutes}} minutes. If you didn't request it, ignore this email.</p>`,
    sampleData: { appName: 'Acme', code: '482913', minutes: 10, brand: 'Acme' },
  },
  {
    slug: 'contact-form',
    name: 'Contact form',
    description: 'Forward a website contact form to your inbox',
    subject: 'New message from {{name}}',
    body: `<p style="margin:0 0 16px;font-weight:600;color:#111827">{{name}} &lt;<a href="mailto:{{email}}" style="color:#4f46e5">{{email}}</a>&gt;</p>
<p style="margin:0;white-space:pre-line">{{message}}</p>`,
    sampleData: { name: 'Ravi', email: 'ravi@example.com', message: 'Hello! I liked your portfolio.', brand: 'Portfolio' },
  },
];

async function main() {
  for (const plan of plans) {
    await prisma.plan.upsert({ where: { code: plan.code }, update: {}, create: plan });
  }
  for (const preset of presets) {
    await prisma.providerPreset.upsert({ where: { name: preset.name }, update: {}, create: preset });
  }

  // Databases seeded before HTML-only templates have an MJML "Default" layout: keep it for templates
  // that still use it, under a legacy name, and add the HTML one.
  await prisma.layout.updateMany({ where: { isSystem: true, name: 'Default', format: 'mjml' }, data: { name: 'Default (MJML, legacy)' } });
  const layout =
    (await prisma.layout.findFirst({ where: { isSystem: true, name: 'Default', format: 'html' } })) ??
    (await prisma.layout.create({ data: { name: 'Default', isSystem: true, format: 'html', body: systemLayout } }));

  for (const t of gallery) {
    const version = { subject: t.subject, format: 'html' as const, body: t.body, sampleData: t.sampleData };
    const exists = await prisma.template.findFirst({ where: { isGallery: true, slug: t.slug }, include: { versions: { orderBy: { version: 'desc' }, take: 1 } } });
    if (!exists) {
      await prisma.template.create({
        data: { name: t.name, slug: t.slug, description: t.description, isSystem: true, isGallery: true, layoutId: layout.id, versions: { create: { version: 1, ...version } } },
      });
    } else if (exists.versions[0]?.format === 'mjml') {
      const next = exists.currentVersion + 1;
      await prisma.template.update({
        where: { id: exists.id },
        data: { layoutId: layout.id, currentVersion: next, versions: { create: { version: next, ...version } } },
      });
    }
  }

  const adminEmail = process.env.ADMIN_EMAIL;
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (adminEmail && adminPassword) {
    const free = await prisma.plan.findUniqueOrThrow({ where: { code: 'free' } });
    await prisma.user.upsert({
      where: { email: adminEmail.toLowerCase() },
      update: { role: 'admin' },
      create: {
        email: adminEmail.toLowerCase(),
        name: 'Admin',
        role: 'admin',
        passwordHash: await hash(adminPassword),
        emailVerifiedAt: new Date(),
        planId: free.id,
      },
    });
    console.log(`admin: ${adminEmail}`);
  } else {
    console.log('ADMIN_EMAIL/ADMIN_PASSWORD not set; skipping admin user');
  }
  console.log('seed done');
}

main().finally(() => prisma.$disconnect());
