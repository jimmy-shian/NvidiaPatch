import { describe, it, expect } from 'vitest';
import { validateExternalUrl } from '../web/urlValidator';

describe('URL Validator & SSRF Protection', () => {
  it('allows valid public HTTPS and HTTP URLs', () => {
    expect(validateExternalUrl('https://example.com/article').valid).toBe(true);
    expect(validateExternalUrl('http://news.ycombinator.com').valid).toBe(true);
    expect(validateExternalUrl('https://raw.githubusercontent.com/user/repo/main/README.md').valid).toBe(true);
  });

  it('rejects localhost and loopback addresses', () => {
    expect(validateExternalUrl('http://localhost:3000').valid).toBe(false);
    expect(validateExternalUrl('http://127.0.0.1:8080/secret').valid).toBe(false);
    expect(validateExternalUrl('http://0.0.0.0').valid).toBe(false);
    expect(validateExternalUrl('http://[::1]/').valid).toBe(false);
  });

  it('rejects private IPv4 networks (RFC 1918)', () => {
    expect(validateExternalUrl('http://10.0.0.1/admin').valid).toBe(false);
    expect(validateExternalUrl('http://192.168.1.1').valid).toBe(false);
    expect(validateExternalUrl('http://172.16.0.10').valid).toBe(false);
    expect(validateExternalUrl('http://172.31.255.254').valid).toBe(false);
  });

  it('rejects cloud metadata IP (169.254.169.254)', () => {
    expect(validateExternalUrl('http://169.254.169.254/latest/meta-data/').valid).toBe(false);
  });

  it('rejects forbidden protocols', () => {
    expect(validateExternalUrl('file:///etc/passwd').valid).toBe(false);
    expect(validateExternalUrl('ftp://example.com').valid).toBe(false);
    expect(validateExternalUrl('data:text/html,<h1>hi</h1>').valid).toBe(false);
    expect(validateExternalUrl('javascript:alert(1)').valid).toBe(false);
  });
});
