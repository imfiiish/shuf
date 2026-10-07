import {
  createHash,
  randomBytes,
  scrypt as scryptCb,
  timingSafeEqual,
} from 'node:crypto'
import { promisify } from 'node:util'

const scrypt = promisify(scryptCb)

// Same parameters as Node's default scrypt profile; 128*N*r = 16 MiB.
const N = 16384
const R = 8
const P = 1
const KEYLEN = 32

/**
 * Hash a PIN with scrypt and encode everything needed to verify it later as a
 * single self-describing string:  scrypt$N$r$p$<salt b64>$<key b64>
 *
 * A 4-digit PIN has only 10k values, so this is not what makes it safe — the
 * login throttling in auth.ts is. But hashing still keeps a DB leak from
 * handing out the PINs directly.
 */
export async function hashPin(pin: string): Promise<string> {
  const salt = randomBytes(16)
  const key = (await scrypt(pin, salt, KEYLEN, { N, r: R, p: P })) as Buffer
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${key.toString('base64')}`
}

export async function verifyPin(pin: string, stored: string | null): Promise<boolean> {
  if (!stored) return false
  const parts = stored.split('$')
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false
  const [, n, r, p, saltB64, keyB64] = parts
  const salt = Buffer.from(saltB64, 'base64')
  const expected = Buffer.from(keyB64, 'base64')
  if (expected.length === 0) return false
  const key = (await scrypt(pin, salt, expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
  })) as Buffer
  return key.length === expected.length && timingSafeEqual(key, expected)
}

/** Opaque session token handed to the client. */
export function newToken(): string {
  return randomBytes(32).toString('base64url')
}

/** Only this hash is stored, so a DB leak cannot be replayed as a session. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}
