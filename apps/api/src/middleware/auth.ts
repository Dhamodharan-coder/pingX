import { prisma } from '@pingx/db';
import { AppError, sha256 } from '@pingx/shared';
import type { RequestHandler } from 'express';
import { verifyAccessToken } from '../lib/jwt';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      userId?: string;
      role?: 'user' | 'admin';
      apiKey?: { id: string; projectId: string };
    }
  }
}

export const requireUser: RequestHandler = async (req, _res, next) => {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ') || header.startsWith('Bearer pgx_')) {
    throw new AppError('unauthorized', 401, 'Missing access token');
  }
  let claims;
  try {
    claims = await verifyAccessToken(header.slice(7));
  } catch {
    throw new AppError('unauthorized', 401, 'Invalid or expired access token');
  }
  const user = await prisma.user.findUnique({ where: { id: claims.sub }, select: { role: true, disabledAt: true } });
  if (!user || user.disabledAt) throw new AppError('unauthorized', 401, 'Account disabled');
  req.userId = claims.sub;
  req.role = user.role;
  next();
};

export const requireAdmin: RequestHandler = (req, _res, next) => {
  if (req.role !== 'admin') throw new AppError('forbidden', 403, 'Admin only');
  next();
};

export const requireApiKey: RequestHandler = async (req, _res, next) => {
  const header = req.headers.authorization;
  const key = header?.startsWith('Bearer ') ? header.slice(7) : (req.headers['x-api-key'] as string | undefined);
  if (!key?.startsWith('pgx_')) throw new AppError('unauthorized', 401, 'Missing API key');
  const apiKey = await prisma.apiKey.findUnique({
    where: { keyHash: sha256(key) },
    include: { project: { select: { userId: true, user: { select: { disabledAt: true } } } } },
  });
  if (!apiKey || apiKey.revokedAt || apiKey.project.user.disabledAt) {
    throw new AppError('unauthorized', 401, 'Invalid API key');
  }
  req.userId = apiKey.project.userId;
  req.apiKey = { id: apiKey.id, projectId: apiKey.projectId };
  void prisma.apiKey.update({ where: { id: apiKey.id }, data: { lastUsedAt: new Date() } }).catch(() => {});
  next();
};
