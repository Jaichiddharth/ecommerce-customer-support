import crypto from "crypto";

/**
 * Base32 alphabet (RFC 4648)
 */
const BASE32_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/**
 * Encode buffer into Base32 string
 */
export function base32Encode(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = "";

  for (let i = 0; i < buffer.length; i++) {
    value = (value << 8) | buffer[i];
    bits += 8;

    while (bits >= 5) {
      output += BASE32_CHARS[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  if (bits > 0) {
    output += BASE32_CHARS[(value << (5 - bits)) & 31];
  }

  return output;
}

/**
 * Decode Base32 string into buffer
 */
export function base32Decode(str: string): Buffer {
  const cleaned = str.toUpperCase().replace(/=+$/, "").replace(/[^A-Z2-7]/g, "");
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];

  for (let i = 0; i < cleaned.length; i++) {
    const idx = BASE32_CHARS.indexOf(cleaned[i]);
    if (idx === -1) continue;

    value = (value << 5) | idx;
    bits += 5;

    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }

  return Buffer.from(bytes);
}

/**
 * Generate a cryptographically secure random TOTP secret (160-bit / 20 bytes)
 */
export function generateTotpSecret(): string {
  const buf = crypto.randomBytes(20);
  return base32Encode(buf);
}

/**
 * Generate an otpauth:// URI to generate a QR code
 */
export function generateTotpUri(label: string, issuer: string, secret: string): string {
  const encodedIssuer = encodeURIComponent(issuer);
  const encodedLabel = encodeURIComponent(`${issuer}:${label}`);
  return `otpauth://totp/${encodedLabel}?secret=${secret}&issuer=${encodedIssuer}&algorithm=SHA1&digits=6&period=30`;
}

/**
 * Compute the 6-digit TOTP token for a given time step
 */
export function computeTotpToken(secret: string, counter: number): string {
  const key = base32Decode(secret);
  const counterBuf = Buffer.alloc(8);
  counterBuf.writeBigInt64BE(BigInt(counter), 0);

  const hmac = crypto.createHmac("sha1", key);
  hmac.update(counterBuf);
  const digest = hmac.digest();

  // Dynamic truncation
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);

  const token = (binary % 1000000).toString().padStart(6, "0");
  return token;
}

/**
 * Verify a 6-digit TOTP token with +/- 1 time step tolerance (prevents minor clock drift)
 */
export function verifyTotpToken(secret: string, token: string, windowSteps: number = 1): boolean {
  if (!token || token.length !== 6 || !/^\d{6}$/.test(token)) {
    return false;
  }

  const currentCounter = Math.floor(Date.now() / 1000 / 30);

  for (let offset = -windowSteps; offset <= windowSteps; offset++) {
    const expected = computeTotpToken(secret, currentCounter + offset);
    if (crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(token))) {
      return true;
    }
  }

  return false;
}

/**
 * Generate 8 backup recovery codes (alphanumeric, formatted e.g. XXXX-XXXX)
 */
export function generateBackupCodes(count: number = 8): string[] {
  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    const bytes = crypto.randomBytes(4).toString("hex").toUpperCase();
    codes.push(`${bytes.slice(0, 4)}-${bytes.slice(4, 8)}`);
  }
  return codes;
}
