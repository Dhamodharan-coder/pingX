import { env } from '../env';

/** With EMAIL_ENABLED off there is no verification step: every account counts as verified. */
export const isEmailVerified = (user: { emailVerifiedAt: Date | null }) => !env.EMAIL_ENABLED || Boolean(user.emailVerifiedAt);
