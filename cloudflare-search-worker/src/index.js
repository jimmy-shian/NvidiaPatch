/**
 * Cloudflare Worker Search Proxy & HTML Extractor
 * 
 * Endpoints:
 * - GET /health -> { status: "ok", version: "1.0.0" }
 * - GET /search?q=...&lang=zh-TW&max=8
 * - GET /fetch?url=...&maxChars=4500
 */

// Simple in-memory rate limiting map (IP -> timestamps)
const rateLimitMap = new Map();

/**
 * Check simple IP rate limit: max 30 requests per 60 seconds
 */
function isRateLimited(clientIp) {
  if (!clientIp) return false;
  const now = Date.now();
  const windowMs = 60 * 1000;
  const maxRequests = 30;

  const timestamps = rateLimitMap.get(clientIp) || [];
  const validTimestamps = timestamps.filter(ts => now - ts < windowMs);

  if (validTimestamps.length >= maxRequests) {
    rateLimitMap.set(clientIp, validTimestamps);
    return true;
  }

  validTimestamps.push(now);
  rateLimitMap.set(clientIp, validTimestamps);

  // Periodically clean stale entries if map gets too large
  if (rateLimitMap.size > 2000) {
    for (const [ip, tsList] of rateLimitMap.entries()) {
      if (tsList.length === 0 || now - tsList[tsList.length - 1] > windowMs) {
        rateLimitMap.delete(ip);
      }
    }
  }

  return false;
}

/**
 * Decode HTML entities
 */
function decodeHtmlEntities(text) {
  if (!text) return '';
  return text
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)));
}

/**
 * Decode Bing /ck/a?!...&u=a1<base64> redirect URLs into original target URLs
 */
function decodeBingUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return '';
  if ((rawUrl.startsWith('http://') || rawUrl.startsWith('https://')) && !rawUrl.includes('bing.com/ck/')) {
    return rawUrl;
  }

  const match = rawUrl.match(/[?&]u=a1([A-Za-z0-9_\-\+/=]+)/);
  if (match && match[1]) {
    let b64Str = match[1].replace(/-/g, '+').replace(/_/g, '/');
    b64Str += '='.repeat((4 - (b64Str.length % 4)) % 4);
    try {
      if (typeof atob === 'function') {
        const binary = atob(b64Str);
        const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
        const decoded = new TextDecoder('utf-8').decode(bytes);
        if (decoded.startsWith('http://') || decoded.startsWith('https://')) {
          return decoded;
        }
      }
    } catch (_) {}
  }

  if (rawUrl.includes('bing.com/ck/')) return '';
  if (rawUrl.startsWith('http://') || rawUrl.startsWith('https://')) return rawUrl;
  return '';
}

/**
 * Parse Bing HTML SERP
 */
function parseBingHtml(html) {
  if (!html || typeof html !== 'string') return [];
  const results = [];
  const seenUrls = new Set();
  const blockRegex = /<(?:li|div)\b[^>]*class=["'][^"']*b_algo[^"']*["'][^>]*>([\s\S]*?)<\/(?:li|div)>/gi;
  let blockMatch;

  while ((blockMatch = blockRegex.exec(html)) !== null && results.length < 10) {
    const block = blockMatch[1];
    // Extract Title & Href: prioritize <h2><a href="...">Title</a></h2> or <h3><a href="...">Title</a></h3>
    const headingMatch = block.match(/<h[23]\b[^>]*>([\s\S]*?)<\/h[23]>/i);
    let rawHref = null;
    let rawTitle = null;

    if (headingMatch) {
      const headingContent = headingMatch[1];
      const headingLink = headingContent.match(/href=["']([^"']+)["']/i);
      if (headingLink) {
        rawHref = headingLink[1];
        rawTitle = headingContent.replace(/<[^>]+>/g, '').trim();
      }
    }

    if (!rawHref) {
      const fallbackLink = block.match(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
      if (fallbackLink) {
        rawHref = fallbackLink[1];
        rawTitle = fallbackLink[2].replace(/<[^>]+>/g, '').trim();
      }
    }

    if (!rawHref) continue;

    rawHref = rawHref.replace(/&amp;/g, '&');
    const realUrl = decodeBingUrl(rawHref);
    if (!realUrl || seenUrls.has(realUrl)) continue;
    seenUrls.add(realUrl);

    const snippetMatch = block.match(/<div\b[^>]*class=["'][^"']*(?:b_caption|b_snippet|b_lineclamp)[^"']*["'][^>]*>([\s\S]*?)<\/div>/i) ||
                         block.match(/<p\b[^>]*>([\s\S]*?)<\/p>/i);
    const rawSnippet = snippetMatch ? snippetMatch[1].replace(/<[^>]+>/g, '').trim() : '';

    results.push({
      title: decodeHtmlEntities(rawTitle || realUrl),
      url: realUrl,
      snippet: decodeHtmlEntities(rawSnippet),
      source: 'bing'
    });
  }

  return results;
}

/**
 * Resolve DuckDuckGo uddg tracking redirect into destination URL
 */
function resolveDuckDuckGoUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return '';
  let url = rawUrl;
  if (url.includes('uddg=')) {
    const match = url.match(/uddg=([^&]+)/);
    if (match && match[1]) {
      try {
        url = decodeURIComponent(match[1]);
      } catch (_) {}
    }
  }
  if (url.startsWith('//')) {
    url = 'https:' + url;
  }
  if (url.startsWith('/l/?kh=') || url.startsWith('/l/?')) {
    const match = url.match(/uddg=([^&]+)/);
    if (match && match[1]) {
      try {
        url = decodeURIComponent(match[1]);
      } catch (_) {}
    }
  }
  return url.startsWith('http://') || url.startsWith('https://') ? url : '';
}

/**
 * Parse DuckDuckGo HTML SERP
 */
function parseDuckDuckGoHtml(html) {
  if (!html || typeof html !== 'string') return [];
  const results = [];
  const seenUrls = new Set();
  const resultBlocks = html.split(/<div\b[^>]*class=["'][^"']*(?:results_links|web-result|result\b)[^"']*["'][^>]*>/i);

  for (let i = 1; i < resultBlocks.length && results.length < 10; i++) {
    const block = resultBlocks[i];
    const titleMatch = block.match(/<a\b[^>]*class=["'][^"']*(?:result__a|result-link)[^"']*["'][^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
    const snippetMatch = block.match(/<a\b[^>]*class=["'][^"']*result__snippet[^"']*["'][^>]*>([\s\S]*?)<\/a>/i) ||
                         block.match(/<(?:td|div|p)\b[^>]*class=["'][^"']*(?:result-snippet|result__snippet)[^"']*["'][^>]*>([\s\S]*?)<\/(?:td|div|p)>/i);

    if (titleMatch) {
      const rawHref = titleMatch[1];
      const rawTitle = titleMatch[2].replace(/<[^>]+>/g, '').trim();
      const resolvedUrl = resolveDuckDuckGoUrl(rawHref);

      if (resolvedUrl && !seenUrls.has(resolvedUrl)) {
        seenUrls.add(resolvedUrl);
        const rawSnippet = snippetMatch ? snippetMatch[1].replace(/<[^>]+>/g, '').trim() : '';

        results.push({
          title: decodeHtmlEntities(rawTitle || resolvedUrl),
          url: resolvedUrl,
          snippet: decodeHtmlEntities(rawSnippet),
          source: 'duckduckgo'
        });
      }
    }
  }

  if (results.length === 0) {
    const directRegex = /<a\b[^>]*class=["'][^"']*(?:result__a|result__snippet)[^"']*["'][^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
    let match;
    while ((match = directRegex.exec(html)) !== null && results.length < 8) {
      const resolvedUrl = resolveDuckDuckGoUrl(match[1]);
      if (!resolvedUrl || seenUrls.has(resolvedUrl)) continue;
      seenUrls.add(resolvedUrl);
      const text = match[2].replace(/<[^>]+>/g, '').trim();
      results.push({
        title: decodeHtmlEntities(text || resolvedUrl),
        url: resolvedUrl,
        snippet: decodeHtmlEntities(text),
        source: 'duckduckgo'
      });
    }
  }

  return results;
}

/**
 * Parse Mojeek HTML SERP
 */
function parseMojeekHtml(html) {
  if (!html || typeof html !== 'string') return [];
  const results = [];
  const seenUrls = new Set();
  const liRegex = /<li\b[^>]*>([\s\S]*?)<\/li>/gi;
  let liMatch;

  while ((liMatch = liRegex.exec(html)) !== null && results.length < 10) {
    const liHtml = liMatch[1];
    const linkMatch = liHtml.match(/<a\b[^>]*class=["'][^"']*(?:title|ob)[^"']*["'][^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i) ||
                      liHtml.match(/<a\b[^>]*href=["'](https?:\/\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
    if (!linkMatch) continue;

    const rawHref = linkMatch[1];
    const rawTitle = linkMatch[2].replace(/<[^>]+>/g, '').trim();
    if (!rawHref.startsWith('http://') && !rawHref.startsWith('https://')) continue;
    if (seenUrls.has(rawHref)) continue;
    seenUrls.add(rawHref);

    const snippetMatch = liHtml.match(/<p\b[^>]*class=["'][^"']*snippet[^"']*["'][^>]*>([\s\S]*?)<\/p>/i);
    const rawSnippet = snippetMatch ? snippetMatch[1].replace(/<[^>]+>/g, '').trim() : '';

    results.push({
      title: decodeHtmlEntities(rawTitle || rawHref),
      url: rawHref,
      snippet: decodeHtmlEntities(rawSnippet),
      source: 'mojeek'
    });
  }

  return results;
}

/**
 * Check for Cloudflare / Anti-bot challenges
 */
function isAntiBotChallenge(html) {
  if (!html || typeof html !== 'string') return false;
  return (
    html.includes('cf-browser-verification') ||
    html.includes('challenge-running') ||
    html.includes('Attention Required! | Cloudflare') ||
    html.includes('Checking your browser before accessing') ||
    html.includes('anomalyDetectionBlock') ||
    html.includes('bots use duckduckgo')
  );
}

/**
 * Validate external URL against basic SSRF (protocol check)
 */
function isValidExternalUrl(urlString) {
  try {
    const parsed = new URL(urlString);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return false;
    }
    const host = parsed.hostname.toLowerCase();
    if (host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0' || host === '::1' || host.endsWith('.local') || host.endsWith('.internal')) {
      return false;
    }
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * Sanitize extracted text
 */
function sanitizeText(text, maxChars = 4500) {
  if (!text) return '';
  let sanitized = text
    .replace(/<[^>]+>/g, ' ')
    .replace(/[^\S\r\n]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  // Strip prompt injection attempts
  sanitized = sanitized
    .replace(/ignore\s+all\s+(previous|prior)\s+instructions/gi, '[filtered external instruction]')
    .replace(/system\s+prompt\s*:\s*/gi, '[filtered pattern] ')
    .replace(/disregard\s+(the\s+above|all\s+preceding)/gi, '[filtered external instruction]');

  if (sanitized.length > maxChars) {
    sanitized = sanitized.slice(0, maxChars) + '... [Content truncated to budget limit]';
  }
  return sanitized;
}

/**
 * Stream extract text from response using HTMLRewriter
 */
async function extractContentStream(response, maxChars = 4500) {
  let title = '';
  let metaDesc = '';
  const textChunks = [];
  let currentLength = 0;
  let isStopped = false;

  const rewriter = new HTMLRewriter()
    .on('title', {
      text(textChunk) {
        if (!isStopped && textChunk.text) {
          title += textChunk.text;
        }
      }
    })
    .on('meta[name="description"]', {
      element(element) {
        const content = element.getAttribute('content');
        if (content && !metaDesc) metaDesc = content;
      }
    })
    .on('meta[property="og:description"]', {
      element(element) {
        const content = element.getAttribute('content');
        if (content && !metaDesc) metaDesc = content;
      }
    })
    .on('meta[property="og:title"]', {
      element(element) {
        const content = element.getAttribute('content');
        if (content && !title) title = content;
      }
    })
    .on('p, article, li, h1, h2, h3, h4, blockquote', {
      text(textChunk) {
        if (isStopped) return;
        const t = textChunk.text;
        if (t && t.trim()) {
          textChunks.push(t);
          currentLength += t.length;
          if (currentLength >= maxChars) {
            isStopped = true;
          }
        }
      }
    });

  const transformed = rewriter.transform(response);
  const reader = transformed.body.getReader();

  try {
    while (true) {
      const { done } = await reader.read();
      if (done || isStopped) break;
    }
  } catch (_) {
    // Stream reading finished or aborted
  } finally {
    try {
      reader.cancel();
    } catch (_) {}
  }

  const rawText = textChunks.join(' ');
  const cleanContent = sanitizeText(rawText, maxChars);
  const cleanTitle = decodeHtmlEntities(title.trim());
  const cleanSnippet = decodeHtmlEntities(metaDesc.trim()) || cleanContent.slice(0, 200) + '...';

  return {
    title: cleanTitle,
    snippet: cleanSnippet,
    content: cleanContent
  };
}

/**
 * Execute search cascade: Bing -> DuckDuckGo -> Mojeek
 */
async function executeSearchCascade(query, lang = 'zh-TW', max = 8) {
  const providers = ['bing', 'duckduckgo', 'mojeek'];
  const providerErrors = [];

  for (const provider of providers) {
    try {
      let results = [];
      if (provider === 'bing') {
        const bingUrl = `https://www.bing.com/search?q=${encodeURIComponent(query)}&setlang=${encodeURIComponent(lang.toLowerCase())}`;
        const res = await fetch(bingUrl, {
          headers: {
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': `${lang},zh;q=0.9,en-US;q=0.8,en;q=0.7`,
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
          }
        });
        if (!res.ok) {
          providerErrors.push({ provider: 'bing', errorKind: `http_${res.status}`, status: res.status });
          continue;
        }
        const html = await res.text();
        if (isAntiBotChallenge(html)) {
          providerErrors.push({ provider: 'bing', errorKind: 'challenge' });
          continue;
        }
        results = parseBingHtml(html);
      } else if (provider === 'duckduckgo') {
        const res = await fetch('https://html.duckduckgo.com/html/', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Accept': 'text/html,application/xhtml+xml',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:120.0) Gecko/20100101 Firefox/120.0',
            'Referer': 'https://html.duckduckgo.com/'
          },
          body: `q=${encodeURIComponent(query)}&b=`
        });
        if (!res.ok) {
          providerErrors.push({ provider: 'duckduckgo', errorKind: `http_${res.status}`, status: res.status });
          continue;
        }
        const html = await res.text();
        if (isAntiBotChallenge(html)) {
          providerErrors.push({ provider: 'duckduckgo', errorKind: 'challenge' });
          continue;
        }
        results = parseDuckDuckGoHtml(html);
      } else if (provider === 'mojeek') {
        const mojeekUrl = `https://www.mojeek.com/search?q=${encodeURIComponent(query)}`;
        const res = await fetch(mojeekUrl, {
          headers: {
            'Accept': 'text/html,application/xhtml+xml',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:120.0) Gecko/20100101 Firefox/120.0'
          }
        });
        if (!res.ok) {
          providerErrors.push({ provider: 'mojeek', errorKind: `http_${res.status}`, status: res.status });
          continue;
        }
        const html = await res.text();
        if (isAntiBotChallenge(html)) {
          providerErrors.push({ provider: 'mojeek', errorKind: 'challenge' });
          continue;
        }
        results = parseMojeekHtml(html);
      }

      if (results && results.length > 0) {
        return {
          query,
          effectiveProvider: provider,
          results: results.slice(0, max),
          count: Math.min(results.length, max),
          providerErrors,
          error: null,
          errorKind: null
        };
      } else {
        providerErrors.push({ provider, errorKind: 'no_results' });
      }
    } catch (err) {
      providerErrors.push({
        provider,
        errorKind: err.name === 'TimeoutError' ? 'timeout' : 'network_error',
        message: err.message
      });
    }
  }

  // All providers failed
  const primaryErrorKind = providerErrors.find(e => e.errorKind === 'challenge')?.errorKind ||
                           providerErrors.find(e => e.errorKind?.startsWith('http_'))?.errorKind ||
                           'no_results';

  return {
    query,
    effectiveProvider: null,
    results: [],
    count: 0,
    providerErrors,
    error: 'All search providers in worker cascade failed',
    errorKind: primaryErrorKind
  };
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const clientIp = request.headers.get('CF-Connecting-IP') || 'unknown';

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, X-Api-Key, Authorization',
          'Access-Control-Max-Age': '86400'
        }
      });
    }

    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Content-Type': 'application/json; charset=utf-8'
    };

    // Health check endpoint (public, unauthenticated for quick connection test)
    if (url.pathname === '/health') {
      return new Response(JSON.stringify({ status: 'ok', version: '1.0.0' }), {
        status: 200,
        headers: corsHeaders
      });
    }

    // Secret validation
    const expectedSecret = env.API_KEY;
    if (expectedSecret) {
      const providedSecret = request.headers.get('X-Api-Key') || url.searchParams.get('key');
      if (!providedSecret || providedSecret !== expectedSecret) {
        return new Response(JSON.stringify({
          error: 'Unauthorized. Invalid or missing X-Api-Key',
          errorKind: 'unauthorized'
        }), {
          status: 401,
          headers: corsHeaders
        });
      }
    }

    // Rate limiting check
    if (isRateLimited(clientIp)) {
      return new Response(JSON.stringify({
        error: 'Too many requests. Rate limit exceeded (30 req / 60s)',
        errorKind: 'rate_limited'
      }), {
        status: 429,
        headers: { ...corsHeaders, 'Retry-After': '60' }
      });
    }

    // Cache instance
    let cache = null;
    try {
      cache = caches.default;
    } catch (_) {}

    // Search endpoint
    if (url.pathname === '/search') {
      const q = (url.searchParams.get('q') || '').trim();
      const lang = url.searchParams.get('lang') || 'zh-TW';
      const max = parseInt(url.searchParams.get('max') || '8', 10);

      if (!q) {
        return new Response(JSON.stringify({
          query: '',
          effectiveProvider: null,
          results: [],
          count: 0,
          error: 'Missing search query parameter q',
          errorKind: 'invalid_parameter'
        }), {
          status: 400,
          headers: corsHeaders
        });
      }

      // Check Cache API (30 min cache for search results)
      const cacheKeyUrl = new URL(url.origin + '/search');
      cacheKeyUrl.searchParams.set('q', q);
      cacheKeyUrl.searchParams.set('lang', lang);
      cacheKeyUrl.searchParams.set('max', String(max));
      const cacheKey = new Request(cacheKeyUrl.toString(), { method: 'GET' });

      if (cache) {
        const cachedRes = await cache.match(cacheKey);
        if (cachedRes) {
          const resClone = new Response(cachedRes.body, cachedRes);
          resClone.headers.set('X-Cache-Status', 'HIT');
          return resClone;
        }
      }

      const searchResult = await executeSearchCascade(q, lang, max);
      const res = new Response(JSON.stringify(searchResult), {
        status: searchResult.error ? (searchResult.errorKind === 'challenge' ? 502 : 200) : 200,
        headers: {
          ...corsHeaders,
          'Cache-Control': 'public, max-age=1800',
          'X-Cache-Status': 'MISS'
        }
      });

      if (cache && !searchResult.error && searchResult.results?.length > 0) {
        ctx.waitUntil(cache.put(cacheKey, res.clone()));
      }

      return res;
    }

    // Fetch endpoint (direct page reading with HTMLRewriter)
    if (url.pathname === '/fetch') {
      const targetUrl = (url.searchParams.get('url') || '').trim();
      const maxChars = parseInt(url.searchParams.get('maxChars') || '4500', 10);

      if (!targetUrl || !isValidExternalUrl(targetUrl)) {
        return new Response(JSON.stringify({
          ok: false,
          url: targetUrl,
          error: 'Invalid, missing or forbidden target URL',
          errorKind: 'invalid_url'
        }), {
          status: 400,
          headers: corsHeaders
        });
      }

      // Cache API (1 hour cache for fetched pages)
      const cacheKeyUrl = new URL(url.origin + '/fetch');
      cacheKeyUrl.searchParams.set('url', targetUrl);
      cacheKeyUrl.searchParams.set('maxChars', String(maxChars));
      const cacheKey = new Request(cacheKeyUrl.toString(), { method: 'GET' });

      if (cache) {
        const cachedRes = await cache.match(cacheKey);
        if (cachedRes) {
          const resClone = new Response(cachedRes.body, cachedRes);
          resClone.headers.set('X-Cache-Status', 'HIT');
          return resClone;
        }
      }

      try {
        const pageRes = await fetch(targetUrl, {
          headers: {
            'Accept': 'text/html,application/xhtml+xml,text/plain;q=0.9',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
          }
        });

        if (!pageRes.ok) {
          return new Response(JSON.stringify({
            ok: false,
            url: targetUrl,
            error: `HTTP ${pageRes.status}`,
            errorKind: `http_${pageRes.status}`
          }), {
            status: 200,
            headers: corsHeaders
          });
        }

        // Check content type
        const contentType = pageRes.headers.get('content-type') || '';
        if (!contentType.includes('text/html') && !contentType.includes('text/plain') && !contentType.includes('application/xhtml+xml')) {
          return new Response(JSON.stringify({
            ok: false,
            url: targetUrl,
            error: `Unsupported content type: ${contentType}`,
            errorKind: 'unsupported_content_type'
          }), {
            status: 200,
            headers: corsHeaders
          });
        }

        const extracted = await extractContentStream(pageRes, maxChars);

        if (!extracted.content || extracted.content.length < 50) {
          return new Response(JSON.stringify({
            ok: false,
            url: targetUrl,
            title: extracted.title || targetUrl,
            error: 'Insufficient readable text in webpage',
            errorKind: 'insufficient_text'
          }), {
            status: 200,
            headers: corsHeaders
          });
        }

        const resultObj = {
          ok: true,
          title: extracted.title || targetUrl,
          url: targetUrl,
          snippet: extracted.snippet,
          content: extracted.content,
          error: null
        };

        const res = new Response(JSON.stringify(resultObj), {
          status: 200,
          headers: {
            ...corsHeaders,
            'Cache-Control': 'public, max-age=3600',
            'X-Cache-Status': 'MISS'
          }
        });

        if (cache) {
          ctx.waitUntil(cache.put(cacheKey, res.clone()));
        }

        return res;
      } catch (err) {
        return new Response(JSON.stringify({
          ok: false,
          url: targetUrl,
          error: err.message || 'Fetch failed',
          errorKind: err.name === 'TimeoutError' ? 'timeout' : 'fetch_error'
        }), {
          status: 200,
          headers: corsHeaders
        });
      }
    }

    return new Response(JSON.stringify({ error: 'Endpoint not found', errorKind: 'not_found' }), {
      status: 404,
      headers: corsHeaders
    });
  }
};
