import * as crypto from 'crypto';
import { QAAPIConfig, AuthConfig, TestSuite } from '../types';

/**
 * Encrypted bundle format for sharing .qaapi/ between colleagues.
 *
 * Design:
 *  - Password → 256-bit key via PBKDF2-HMAC-SHA256 (210k iterations, OWASP 2023).
 *  - Plaintext payload (JSON) encrypted with AES-256-GCM; IV is random per bundle.
 *  - Everything (salt, iv, ciphertext, authTag) base64 in the outer JSON so the
 *    bundle can travel over any text channel (Slack paste, email, git, etc).
 *  - Auth tag is verified on decryption — wrong password fails fast and loudly.
 *
 * The password exchange is the weak link. The UI warns users to send the
 * password through a different channel than the bundle file itself.
 */

const KDF = 'pbkdf2-sha256';
const ITERATIONS = 210_000;
const KEY_LENGTH = 32;     // AES-256
const IV_LENGTH = 12;      // GCM standard
const SALT_LENGTH = 16;
const CIPHER = 'aes-256-gcm';

export interface BundlePayload {
  exportedAt: string;
  config: QAAPIConfig;
  auth: AuthConfig | null;
  tests: TestSuite[];
}

export interface EncryptedBundle {
  qaapi: 'bundle';
  version: 1;
  encrypted: true;
  kdf: typeof KDF;
  iterations: number;
  salt: string;        // base64
  iv: string;          // base64
  ciphertext: string;  // base64
  authTag: string;     // base64
}

export function encryptBundle(payload: BundlePayload, password: string): EncryptedBundle {
  if (!password) throw new Error('Password is required');

  const salt = crypto.randomBytes(SALT_LENGTH);
  const iv = crypto.randomBytes(IV_LENGTH);
  const key = crypto.pbkdf2Sync(password, salt, ITERATIONS, KEY_LENGTH, 'sha256');

  const cipher = crypto.createCipheriv(CIPHER, key, iv);
  const plaintext = Buffer.from(JSON.stringify(payload), 'utf-8');
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return {
    qaapi: 'bundle',
    version: 1,
    encrypted: true,
    kdf: KDF,
    iterations: ITERATIONS,
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    ciphertext: ciphertext.toString('base64'),
    authTag: authTag.toString('base64'),
  };
}

export function decryptBundle(bundle: EncryptedBundle, password: string): BundlePayload {
  if (bundle.qaapi !== 'bundle') throw new Error('Not a qaapi bundle');
  if (bundle.version !== 1) throw new Error(`Unsupported bundle version: ${bundle.version}`);
  if (bundle.kdf !== KDF) throw new Error(`Unsupported KDF: ${bundle.kdf}`);

  const salt = Buffer.from(bundle.salt, 'base64');
  const iv = Buffer.from(bundle.iv, 'base64');
  const ciphertext = Buffer.from(bundle.ciphertext, 'base64');
  const authTag = Buffer.from(bundle.authTag, 'base64');

  const key = crypto.pbkdf2Sync(password, salt, bundle.iterations, KEY_LENGTH, 'sha256');

  const decipher = crypto.createDecipheriv(CIPHER, key, iv);
  decipher.setAuthTag(authTag);

  try {
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return JSON.parse(plaintext.toString('utf-8')) as BundlePayload;
  } catch {
    // GCM auth tag mismatch → either wrong password or tampered bundle
    throw new Error('Decryption failed. Wrong password or the bundle is corrupt.');
  }
}

export function isEncryptedBundle(raw: unknown): raw is EncryptedBundle {
  if (!raw || typeof raw !== 'object') return false;
  const b = raw as Record<string, unknown>;
  return b.qaapi === 'bundle' && b.version === 1 && b.encrypted === true;
}
