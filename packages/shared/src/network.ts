import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

const V4_PRIVATE: [number, number][] = [
  [0x00000000, 8], // 0.0.0.0/8
  [0x0a000000, 8], // 10/8
  [0x64400000, 10], // 100.64/10 (CGNAT)
  [0x7f000000, 8], // 127/8
  [0xa9fe0000, 16], // 169.254/16 (link-local, cloud metadata)
  [0xac100000, 12], // 172.16/12
  [0xc0a80000, 16], // 192.168/16
  [0xe0000000, 4], // multicast + reserved
];

export function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 4) {
    const n = ip.split('.').reduce((a, o) => (a << 8) + Number(o), 0) >>> 0;
    return V4_PRIVATE.some(([base, bits]) => n >>> (32 - bits) === base >>> (32 - bits));
  }
  const v6 = ip.toLowerCase();
  if (v6.startsWith('::ffff:')) return isPrivateAddress(v6.slice(7));
  return v6 === '::' || v6 === '::1' || v6.startsWith('fc') || v6.startsWith('fd') || v6.startsWith('fe80');
}

/** Rejects hosts that resolve to loopback/private/link-local addresses (SSRF guard for user-supplied hosts). */
export async function assertPublicHost(host: string): Promise<void> {
  const addresses = isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
  if (addresses.length === 0 || addresses.some((a) => isPrivateAddress(a.address))) {
    throw new Error(`${host} resolves to a private or reserved address`);
  }
}
