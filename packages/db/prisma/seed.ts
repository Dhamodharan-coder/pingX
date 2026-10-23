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

const systemLayout = `<mjml>
  <mj-body background-color="#f4f4f5">
    <mj-section padding="24px 0"><mj-column><mj-text align="center" font-size="20px" font-weight="700">{{brand}}</mj-text></mj-column></mj-section>
    <mj-section background-color="#ffffff" border-radius="8px" padding="24px"><mj-column>{{{content}}}</mj-column></mj-section>
    <mj-section><mj-column><mj-text align="center" font-size="12px" color="#71717a">Sent with PingX</mj-text></mj-column></mj-section>
  </mj-body>
</mjml>`;

const gallery = [
  {
    slug: 'welcome',
    name: 'Welcome',
    description: 'Greet a new user after signup',
    subject: 'Welcome to {{appName}}, {{name}}!',
    body: `<mj-text font-size="18px" font-weight="600">Hi {{name}},</mj-text>
<mj-text>Thanks for joining {{appName}}. We're glad to have you.</mj-text>
<mj-button href="{{ctaUrl}}" background-color="#4f46e5">Get started</mj-button>`,
    sampleData: { name: 'Asha', appName: 'Acme', ctaUrl: 'https://example.com', brand: 'Acme' },
  },
  {
    slug: 'otp',
    name: 'One-time code',
    description: 'Send a login or verification code',
    subject: 'Your {{appName}} code: {{code}}',
    body: `<mj-text>Use this code to continue:</mj-text>
<mj-text font-size="32px" font-weight="700" letter-spacing="6px" align="center">{{code}}</mj-text>
<mj-text color="#71717a">It expires in {{minutes}} minutes. If you didn't request it, ignore this email.</mj-text>`,
    sampleData: { appName: 'Acme', code: '482913', minutes: 10, brand: 'Acme' },
  },
  {
    slug: 'contact-form',
    name: 'Contact form',
    description: 'Forward a website contact form to your inbox',
    subject: 'New message from {{name}}',
    body: `<mj-text font-weight="600">{{name}} &lt;{{email}}&gt;</mj-text>
<mj-text>{{message}}</mj-text>`,
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

  const layout =
    (await prisma.layout.findFirst({ where: { isSystem: true, name: 'Default' } })) ??
    (await prisma.layout.create({ data: { name: 'Default', isSystem: true, format: 'mjml', body: systemLayout } }));

  for (const t of gallery) {
    const exists = await prisma.template.findFirst({ where: { isGallery: true, slug: t.slug } });
    if (exists) continue;
    await prisma.template.create({
      data: {
        name: t.name,
        slug: t.slug,
        description: t.description,
        isSystem: true,
        isGallery: true,
        layoutId: layout.id,
        versions: { create: { version: 1, subject: t.subject, format: 'mjml', body: t.body, sampleData: t.sampleData } },
      },
    });
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
