import { describe, it, expect } from 'vitest';
import { maskApiKey, sanitizeLog } from '../security/secureStorage';

describe('Secure Storage Utilities', () => {
  it('masks API keys safely for UI display', () => {
    expect(maskApiKey('nvapi-1234567890abcdef1234567890')).toBe('nvapi-••••••••7890');
    expect(maskApiKey('sk-abcdef123456')).toBe('sk-abc••••••••3456');
    expect(maskApiKey('short')).toBe('••••••••');
    expect(maskApiKey('')).toBe('');
    expect(maskApiKey(null)).toBe('');
  });

  it('sanitizes logs to prevent sensitive keys from being exposed', () => {
    const rawLog = 'Error connecting with key nvapi-abcdef12345678901234567890 and Bearer eyJhbGciOi...';
    const sanitized = sanitizeLog(rawLog);
    expect(sanitized).not.toContain('nvapi-abcdef12345678901234567890');
    expect(sanitized).toContain('nvapi-***MASKED***');
    expect(sanitized).toContain('Bearer ***MASKED***');
  });
});
