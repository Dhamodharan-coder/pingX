import { describe, expect, it } from 'vitest';
import { assertPublicHost, isPrivateAddress } from './network';

describe('isPrivateAddress', () => {
  it.each(['127.0.0.1', '10.1.2.3', '172.20.0.5', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1'])('%s is private', (ip) => {
    expect(isPrivateAddress(ip)).toBe(true);
  });
  it.each(['8.8.8.8', '172.32.0.1', '142.250.183.109', '2607:f8b0::1'])('%s is public', (ip) => {
    expect(isPrivateAddress(ip)).toBe(false);
  });
  it('rejects localhost by name', async () => {
    await expect(assertPublicHost('localhost')).rejects.toThrow(/private/);
  });
});
