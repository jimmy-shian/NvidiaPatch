/**
 * URL Validator & SSRF Defense Layer
 * Validates external URLs to prevent SSRF and internal network access.
 * Strictly blocks localhost, private IPv4/IPv6, cloud metadata services, and non-HTTP protocols.
 */

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  '::1',
  'metadata.google.internal',
  'instance-data'
]);

/**
 * Validate that an IPv4 address is not private or loopback or link-local
 */
function isPrivateIPv4(ip) {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some(p => isNaN(p) || p < 0 || p > 255)) return true;

  const [a, b] = parts;
  // 127.0.0.0/8 (Loopback)
  if (a === 127) return true;
  // 10.0.0.0/8 (Private)
  if (a === 10) return true;
  // 172.16.0.0/12 (Private)
  if (a === 172 && b >= 16 && b <= 31) return true;
  // 192.168.0.0/16 (Private)
  if (a === 192 && b === 168) return true;
  // 169.254.0.0/16 (Link-local & AWS/GCP/Azure metadata 169.254.169.254)
  if (a === 169 && b === 254) return true;
  // 0.0.0.0/8
  if (a === 0) return true;

  return false;
}

/**
 * Validate an external URL before fetching
 * @param {string} urlString
 * @returns {{ valid: boolean, reason?: string, cleanUrl?: string }}
 */
export function validateExternalUrl(urlString) {
  if (!urlString || typeof urlString !== 'string') {
    return { valid: false, reason: 'Empty or invalid URL parameter' };
  }

  const trimmed = urlString.trim();
  let parsed;

  try {
    parsed = new URL(trimmed);
  } catch (_) {
    return { valid: false, reason: 'Malformed URL syntax' };
  }

  // 1. Only allow http and https protocols
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { valid: false, reason: `Forbidden protocol: ${parsed.protocol}` };
  }

  const hostname = parsed.hostname.toLowerCase();

  // 2. Reject blocked hostnames
  if (BLOCKED_HOSTNAMES.has(hostname) || hostname.endsWith('.localhost') || hostname.endsWith('.local') || hostname.endsWith('.internal')) {
    return { valid: false, reason: `Forbidden internal hostname: ${hostname}` };
  }

  // 3. Reject IPv6 loopback / local addresses
  if (hostname.startsWith('[') && hostname.endsWith(']')) {
    const ipv6 = hostname.slice(1, -1);
    if (ipv6 === '::1' || ipv6.startsWith('fe80') || ipv6.startsWith('fc00') || ipv6.startsWith('fd00')) {
      return { valid: false, reason: `Forbidden private IPv6 address: ${ipv6}` };
    }
  }

  // 4. Reject private / internal IPv4 addresses
  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)) {
    if (isPrivateIPv4(hostname)) {
      return { valid: false, reason: `Forbidden private IPv4 address: ${hostname}` };
    }
  }

  return {
    valid: true,
    cleanUrl: parsed.href
  };
}
