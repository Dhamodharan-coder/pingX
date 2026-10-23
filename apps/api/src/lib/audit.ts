import { prisma, type Prisma } from '@pingx/db';

export const audit = (adminId: string, action: string, targetType: string, targetId?: string, meta?: Prisma.InputJsonValue) =>
  prisma.auditLog.create({ data: { adminId, action, targetType, targetId, meta } });
