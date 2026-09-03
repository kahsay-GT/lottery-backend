import * as crypto from 'crypto';
import * as CryptoJS from 'crypto-js';

export class CryptoUtil {
  static generateRandomToken(bytes = 32): string {
    return crypto.randomBytes(bytes).toString('hex');
  }

  static generateOtp(length = 6): string {
    const digits = '0123456789';
    let otp = '';
    const randomBytes = crypto.randomBytes(length);
    for (let i = 0; i < length; i++) {
      otp += digits[randomBytes[i] % 10];
    }
    return otp;
  }

  static sha256(data: string): string {
    return crypto.createHash('sha256').update(data).digest('hex');
  }

  static hmac(data: string, secret: string): string {
    return crypto.createHmac('sha256', secret).update(data).digest('hex');
  }

  static encrypt(text: string, key: string): string {
    return CryptoJS.AES.encrypt(text, key).toString();
  }

  static decrypt(ciphertext: string, key: string): string {
    const bytes = CryptoJS.AES.decrypt(ciphertext, key);
    return bytes.toString(CryptoJS.enc.Utf8);
  }

  static generateDrawHash(lotteryId: string, seed: string, timestamp: string): string {
    const data = `${lotteryId}:${seed}:${timestamp}`;
    return crypto.createHash('sha256').update(data).digest('hex');
  }

  static seededRandom(seed: string): () => number {
    // Mulberry32 PRNG seeded from SHA256 of seed string
    let hash = 0;
    const seedBytes = crypto.createHash('sha256').update(seed).digest();
    hash =
      ((seedBytes[0] << 24) | (seedBytes[1] << 16) | (seedBytes[2] << 8) | seedBytes[3]) >>> 0;

    return () => {
      hash += 0x6d2b79f5;
      let t = hash;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
}
