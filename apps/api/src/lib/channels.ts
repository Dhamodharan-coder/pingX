import { createChannels } from '@pingx/channels';
import { env } from '../env';

export const channels = createChannels({
  googleClientId: env.GOOGLE_CLIENT_ID,
  googleClientSecret: env.GOOGLE_CLIENT_SECRET,
  allowPrivateHosts: env.NODE_ENV !== 'production',
});
