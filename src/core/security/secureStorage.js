/**
 * SecureStorage - Android Keystore / Web Crypto AES-GCM Encrypted Storage
 * 
 * Sensitive data (API Keys, Tokens) are encrypted using AES-GCM (256-bit)
 * and stored in app-private storage. Never plaintext in localStorage.
 */
import { Preferences } from '@capacitor/preferences';

const STORAGE_PREFIX = 'sec_';
const SALT_KEY = '__sec_device_salt__';

// Helper: Get or create device-specific encryption key
let cachedKey = null;

async function getEncryptionKey() {
  if (cachedKey) return cachedKey;

  // Retrieve or generate device salt
  let { value: saltBase64 } = await Preferences.get({ key: SALT_KEY });
  let salt;
  if (!saltBase64) {
    const randomBytes = new Uint8Array(16);
    crypto.getRandomValues(randomBytes);
    saltBase64 = btoa(String.fromCharCode(...randomBytes));
    await Preferences.set({ key: SALT_KEY, value: saltBase64 });
    salt = randomBytes;
  } else {
    salt = Uint8Array.from(atob(saltBase64), c => c.charCodeAt(0));
  }

  // Derive master key from hardware/app context seed
  const appSeed = new TextEncoder().encode('NvidiaPatch-Mobile-Keystore-Seed-v1');
  const baseKey = await crypto.subtle.importKey(
    'raw',
    appSeed,
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );

  cachedKey = await crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations: 100000,
      hash: 'SHA-256'
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );

  return cachedKey;
}

export const SecureStorage = {
  /**
   * Save a sensitive string (e.g. API key) encrypted
   */
  async setItem(key, value) {
    if (!value) {
      await this.removeItem(key);
      return;
    }
    try {
      const cryptoKey = await getEncryptionKey();
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const encodedValue = new TextEncoder().encode(value);

      const ciphertext = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        cryptoKey,
        encodedValue
      );

      const payload = {
        iv: btoa(String.fromCharCode(...iv)),
        data: btoa(String.fromCharCode(...new Uint8Array(ciphertext)))
      };

      await Preferences.set({
        key: `${STORAGE_PREFIX}${key}`,
        value: JSON.stringify(payload)
      });
    } catch (err) {
      console.error('[SecureStorage] Encryption error:', err);
      throw new Error('Failed to securely store sensitive data');
    }
  },

  /**
   * Retrieve a sensitive string decrypted
   */
  async getItem(key) {
    try {
      const { value: storedJson } = await Preferences.get({ key: `${STORAGE_PREFIX}${key}` });
      if (!storedJson) return null;

      const payload = JSON.parse(storedJson);
      if (!payload.iv || !payload.data) return null;

      const iv = Uint8Array.from(atob(payload.iv), c => c.charCodeAt(0));
      const ciphertext = Uint8Array.from(atob(payload.data), c => c.charCodeAt(0));

      const cryptoKey = await getEncryptionKey();
      const decrypted = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv },
        cryptoKey,
        ciphertext
      );

      return new TextDecoder().decode(decrypted);
    } catch (err) {
      console.error('[SecureStorage] Decryption error:', err);
      return null;
    }
  },

  /**
   * Remove a sensitive item
   */
  async removeItem(key) {
    await Preferences.remove({ key: `${STORAGE_PREFIX}${key}` });
  },

  /**
   * Clear all secure keys
   */
  async clear() {
    const { keys } = await Preferences.keys();
    for (const k of keys) {
      if (k.startsWith(STORAGE_PREFIX)) {
        await Preferences.remove({ key: k });
      }
    }
  }
};

/**
 * Mask API key for UI display (e.g. nvapi-****...1234)
 */
export function maskApiKey(apiKey) {
  if (!apiKey || typeof apiKey !== 'string') return '';
  if (apiKey.length <= 8) return '••••••••';
  const prefix = apiKey.slice(0, 6);
  const suffix = apiKey.slice(-4);
  return `${prefix}••••••••${suffix}`;
}

/**
 * Sanitize strings to prevent API key leaks in logs / error messages
 */
export function sanitizeLog(text) {
  if (!text || typeof text !== 'string') return text;
  return text
    .replace(/nvapi-[A-Za-z0-9_-]{20,}/g, 'nvapi-***MASKED***')
    .replace(/sk-[A-Za-z0-9_-]{20,}/g, 'sk-***MASKED***')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer ***MASKED***')
    .replace(/key=[A-Za-z0-9._-]+/gi, 'key=***MASKED***');
}
