import { AppError } from '@pingx/shared';
import type { z } from 'zod';

export function parse<T extends z.ZodTypeAny>(schema: T, data: unknown): z.infer<T> {
  const result = schema.safeParse(data);
  if (!result.success) {
    const first = result.error.issues[0];
    const path = first?.path.join('.');
    throw new AppError('validation_error', 400, path ? `${path}: ${first?.message}` : (first?.message ?? 'Invalid request'));
  }
  return result.data;
}

export const notFound = (what = 'Resource') => new AppError('not_found', 404, `${what} not found`);
