import crypto from 'crypto';
import { createLogger } from '../logger';

const log = createLogger('crypto');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

/**
 * Derives a 32-byte (256-bit) encryption key from the environment variables.
 */
function getEncryptionKey(): Buffer {
  const secret = process.env.TOKEN_ENCRYPTION_KEY as string;

  // Use SHA-256 to ensure exact 32 bytes key length
  return crypto.createHash('sha256').update(secret).digest();
}

/**
 * Encrypts sensitive plain text (such as Meta Access Tokens) using AES-256-GCM.
 * Output format: `iv:authTag:encryptedData` (hex encoded)
 */
export function encryptToken(plainText: string): string {
  if (!plainText) return '';

  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(plainText, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  const authTag = cipher.getAuthTag();

  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
}

/**
 * Decrypts AES-256-GCM encrypted token string.
 */
export function decryptToken(cipherText: string): string {
  if (!cipherText) return '';

  // If text is not encrypted in the expected iv:authTag:data format, return as is (fallback safe)
  const parts = cipherText.split(':');
  if (parts.length !== 3) {
    return cipherText;
  }

  try {
    const [ivHex, authTagHex, encryptedHex] = parts;
    const key = getEncryptionKey();
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  } catch (error) {
    // Usually TOKEN_ENCRYPTION_KEY changed since the token was stored. Returning '' makes callers
    // report "channel has no valid access token — reconnect" instead of sending ciphertext to Meta.
    log.error('Failed to decrypt stored token (was TOKEN_ENCRYPTION_KEY changed?)', { err: error });
    return '';
  }
}
