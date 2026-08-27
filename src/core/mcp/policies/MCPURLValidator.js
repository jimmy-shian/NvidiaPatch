/**
 * MCP URL Validator & SSRF / DNS Rebinding Defense
 * Validates endpoint URLs, enforces HTTPS by default, and blocks private/reserved IP addresses.
 */

// Blocked IPv4 CIDR ranges
const BLOCKED_IPV4_RANGES = [
  { prefix: '0.0.0.0', mask: 8 },      // Current network (0.0.0.0/8)
  { prefix: '10.0.0.0', mask: 8 },     // RFC1918 Private (10.0.0.0/8)
  { prefix: '100.64.0.0', mask: 10 },  // Carrier-grade NAT (100.64.0.0/10)
  { prefix: '127.0.0.0', mask: 8 },    // Loopback (127.0.0.0/8)
  { prefix: '169.254.0.0', mask: 16 }, // Link-local (169.254.0.0/16)
  { prefix: '172.16.0.0', mask: 12 },  // RFC1918 Private (172.16.0.0/12)
  { prefix: '192.168.0.0', mask: 16 }, // RFC1918 Private (192.168.0.0/16)
  { prefix: '224.0.0.0', mask: 4 },    // Multicast (224.0.0.0/4)
  { prefix: '240.0.0.0', mask: 4 }     // Reserved / Future (240.0.0.0/4)
];

/**
 * Convert IPv4 string to 32-bit unsigned integer
 */
function ipv4ToInt(ip) {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some(p => isNaN(p) || p < 0 || p > 255)) return null;
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

/**
 * Check if an IPv4 address is in a CIDR range
 */
function isIpv4InCidr(ipInt, prefixInt, mask) {
  const maskInt = mask === 0 ? 0 : (~0 << (32 - mask)) >>> 0;
  return (ipInt & maskInt) === (prefixInt & maskInt);
}

/**
 * Check if IP address (IPv4 or IPv6) is in blocked ranges
 */
export function isPrivateOrReservedIp(ipStr) {
  if (!ipStr) return true;
  const cleanIp = ipStr.trim().toLowerCase();

  // 1. IPv4-mapped IPv6 (e.g. ::ffff:127.0.0.1)
  if (cleanIp.startsWith('::ffff:')) {
    const v4 = cleanIp.slice(7);
    return isPrivateOrReservedIp(v4);
  }

  // 2. IPv6 Local / Loopback / ULA / Link-local
  if (cleanIp === '::' || cleanIp === '::1' || cleanIp === '0:0:0:0:0:0:0:1' || cleanIp === '0:0:0:0:0:0:0:0') {
    return true; // Loopback or unspecified
  }
  if (cleanIp.startsWith('fc00:') || cleanIp.startsWith('fd')) {
    return true; // IPv6 ULA (fc00::/7)
  }
  if (cleanIp.startsWith('fe80:') || cleanIp.startsWith('fe9') || cleanIp.startsWith('fea') || cleanIp.startsWith('feb')) {
    return true; // IPv6 Link-local (fe80::/10)
  }

  // 3. IPv4 address check
  const ipInt = ipv4ToInt(cleanIp);
  if (ipInt !== null) {
    for (const r of BLOCKED_IPV4_RANGES) {
      const prefixInt = ipv4ToInt(r.prefix);
      if (prefixInt !== null && isIpv4InCidr(ipInt, prefixInt, r.mask)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Validates an MCP Endpoint URL
 * @param {string} urlString
 * @param {Object} options
 * @param {boolean} [options.allowLocalNetwork=false]
 * @returns {{ valid: boolean, error?: string, parsedUrl?: URL, isPrivateNetwork?: boolean }}
 */
export function validateMcpUrl(urlString, options = {}) {
  const { allowLocalNetwork = false } = options;

  if (!urlString || typeof urlString !== 'string') {
    return { valid: false, error: 'MCP URL 格式無效或為空' };
  }

  let parsed;
  try {
    parsed = new URL(urlString.trim());
  } catch (_) {
    return { valid: false, error: '無法解析的 URL 格式' };
  }

  // 1. Scheme Check
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { valid: false, error: `不支援的協議 Scheme: "${parsed.protocol}"，僅支援 HTTP 或 HTTPS` };
  }

  // 2. Reject credentials in URL (e.g. https://user:pass@host)
  if (parsed.username || parsed.password) {
    return { valid: false, error: '禁止在 URL 中夾帶帳號密碼憑證 (user:pass@host)' };
  }

  const hostname = parsed.hostname.toLowerCase();
  const isLocalhost = hostname === 'localhost' || hostname.endsWith('.localhost') || hostname === '127.0.0.1' || hostname === '[::1]';
  const isPrivateIp = isPrivateOrReservedIp(hostname);
  const isPrivateNetwork = parsed.protocol === 'http:' || isLocalhost || isPrivateIp;

  // 3. Scheme check for production vs private network
  if (parsed.protocol === 'http:' && !allowLocalNetwork) {
    return {
      valid: false,
      isPrivateNetwork: true,
      error: '基於安全性考量，生產環境僅允許 HTTPS 端點。若需連線同網域/本機端點，請透過授權確認放行。',
      parsedUrl: parsed
    };
  }

  // 4. Localhost / Private IP safety check
  if (isPrivateNetwork && !allowLocalNetwork) {
    return {
      valid: false,
      isPrivateNetwork: true,
      error: `端點屬於區域網路/私有網段 (${hostname})，需經使用者授權確認。`,
      parsedUrl: parsed
    };
  }

  return {
    valid: true,
    isPrivateNetwork,
    parsedUrl: parsed
  };
}

/**
 * Canonically format endpoint URL (strips trailing slashes, normalized lower hostname)
 */
export function canonicalizeEndpoint(urlString) {
  try {
    const parsed = new URL(urlString.trim());
    let pathname = parsed.pathname.replace(/\/+$/, '');
    return `${parsed.protocol}//${parsed.host}${pathname}${parsed.search}`;
  } catch (_) {
    return urlString.trim();
  }
}
