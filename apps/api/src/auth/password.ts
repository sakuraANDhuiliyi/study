import { randomBytes, scrypt, scryptSync, timingSafeEqual } from 'node:crypto';
import { ServiceUnavailableException } from '@nestjs/common';

// Keep the synchronous helpers for offline seed/bootstrap callers only.
export function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex');
  return `scrypt$${salt}$${scryptSync(password, salt, 64).toString('hex')}`;
}

const parallelism = 2;
const maxWaiting = 32;
let active = 0;
const waiting: Array<() => void> = [];

async function derive(password: string, salt: string): Promise<Buffer> {
  if (active >= parallelism) {
    if (waiting.length >= maxWaiting) throw new ServiceUnavailableException('密码验证繁忙，请稍后再试');
    await new Promise<void>((resolve) => waiting.push(resolve));
  } else active++;
  try {
    return await new Promise<Buffer>((resolve, reject) => {
      scrypt(password, salt, 64, (error, result) => (error ? reject(error) : resolve(result)));
    });
  } finally {
    const next = waiting.shift();
    if (next) next();
    else active--;
  }
}

export async function hashPasswordAsync(password: string) {
  const salt = randomBytes(16).toString('hex');
  return `scrypt$${salt}$${(await derive(password, salt)).toString('hex')}`;
}

export async function verifyPasswordAsync(password: string, stored: string) {
  const [algorithm, salt, hash, extra] = stored.split('$');
  if (algorithm !== 'scrypt' || !salt || !/^[a-f0-9]{128}$/i.test(hash || '') || extra) return false;
  const actual = await derive(password, salt);
  return timingSafeEqual(actual, Buffer.from(hash, 'hex'));
}
export function verifyPassword(password: string, stored: string) {
  const [algorithm, salt, hash] = stored.split('$');
  if (algorithm !== 'scrypt' || !salt || !hash) return false;
  const actual = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
