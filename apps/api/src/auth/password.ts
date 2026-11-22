import { argon2, randomBytes, timingSafeEqual } from 'node:crypto';
import { authError } from './browser.js';

const parameters = { memory: 19456, passes: 2, parallelism: 1, tagLength: 32 };
const prefix = `$argon2id$v=19$m=${parameters.memory},t=${parameters.passes},p=${parameters.parallelism}$`;
let active = 0;

async function derive(password: string, nonce: Buffer): Promise<Buffer> {
  if (active >= 4) throw authError(429, 'RATE_LIMITED', 'Too many authentication attempts.');
  active++;
  try {
    return await new Promise((resolve, reject) => {
      argon2('argon2id', {
        ...parameters, message: Buffer.from(password), nonce,
      }, (error, key) => error ? reject(error) : resolve(key));
    });
  } finally {
    active--;
  }
}

export async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const hash = await derive(password, salt);
  return `${prefix}${salt.toString('base64').replace(/=+$/, '')}$${hash.toString('base64').replace(/=+$/, '')}`;
}

export async function verifyPassword(password: string, stored: string | undefined) {
  const parsed = stored?.startsWith(prefix)
    ? stored.slice(prefix.length).match(/^([A-Za-z0-9+/]{22})\$([A-Za-z0-9+/]{43})$/)
    : null;
  const salt = parsed ? Buffer.from(parsed[1], 'base64') : Buffer.alloc(16);
  const hash = parsed ? Buffer.from(parsed[2], 'base64') : Buffer.alloc(parameters.tagLength);
  const derived = await derive(password, salt);
  return timingSafeEqual(derived, hash) && parsed !== null;
}
