import { Prisma } from '@pingx/db';
import { isAppError } from '@pingx/shared';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type ErrorRequestHandler } from 'express';
import helmet from 'helmet';
import { env } from './env';
import { getSetting } from './lib/limits';
import { accountRouter } from './routes/account';
import { adminRouter } from './routes/admin';
import { authRouter } from './routes/auth';
import { billingRouter, razorpayWebhookRouter } from './routes/billing';
import { messagesRouter, usageRouter } from './routes/messages';
import { projectsRouter } from './routes/projects';
import { gmailCallbackRouter, providersRouter } from './routes/providers';
import { layoutsRouter, templatesRouter } from './routes/templates';
import { v1Router } from './routes/v1';

const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (isAppError(err)) {
    res.status(err.status).json({ error: { code: err.code, message: err.message } });
    return;
  }
  if (err instanceof SyntaxError && 'body' in err) {
    res.status(400).json({ error: { code: 'invalid_json', message: 'Request body is not valid JSON' } });
    return;
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
    res.status(404).json({ error: { code: 'not_found', message: 'Resource not found' } });
    return;
  }
  if ((err as { type?: string }).type === 'entity.too.large') {
    res.status(413).json({ error: { code: 'payload_too_large', message: 'Request body too large' } });
    return;
  }
  console.error(err);
  res.status(500).json({ error: { code: 'internal_error', message: 'Internal server error' } });
};

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(razorpayWebhookRouter);
  app.use(gmailCallbackRouter);

  // Public send API: any origin, API-key auth, no cookies.
  app.use('/v1', cors(), express.json({ limit: '2mb' }), v1Router);

  app.use(cors({ origin: env.APP_URL, credentials: true }));
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  app.get('/health', (_req, res) => {
    res.json({ ok: true });
  });
  app.get('/settings/public', async (_req, res) => {
    res.json({
      signupEnabled: await getSetting('signup_enabled', true),
      banner: await getSetting<string | null>('banner', null),
      emailEnabled: env.EMAIL_ENABLED,
    });
  });
  app.use('/auth', authRouter);
  app.use('/account', accountRouter);
  app.use('/projects', projectsRouter);
  app.use('/providers', providersRouter);
  app.use('/templates', templatesRouter);
  app.use('/layouts', layoutsRouter);
  app.use('/messages', messagesRouter);
  app.use('/usage', usageRouter);
  app.use('/billing', billingRouter);
  app.use('/admin', adminRouter);

  app.use((_req, res) => {
    res.status(404).json({ error: { code: 'not_found', message: 'Not found' } });
  });
  app.use(errorHandler);
  return app;
}
