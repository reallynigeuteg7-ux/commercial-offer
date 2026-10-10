import { createHash, timingSafeEqual } from 'node:crypto';

// This key grants only the separate desktop orders feed, never CRM admin access.
export function validDesktopAccess(header, hash) {
  if (typeof hash !== 'string' || !/^[a-f0-9]{64}$/.test(hash)) return false;
  if (typeof header !== 'string' || !/^Bearer [a-f0-9]{64}$/.test(header)) return false;
  const actual = createHash('sha256').update(header.slice(7)).digest();
  return timingSafeEqual(actual, Buffer.from(hash, 'hex'));
}
