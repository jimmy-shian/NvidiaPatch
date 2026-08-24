/**
 * Readability-style HTML Content Extractor
 * Strips boilerplate (scripts, navigation, headers, footers, ads, cookie notices)
 * and extracts clean, readable main article text.
 */

// Noise tags to strip completely along with their children
const NOISE_TAG_REGEX = /<(script|style|noscript|svg|canvas|iframe|form|nav|footer|header|aside|video|audio|button|select|textarea)\b[^<]*(?:(?!<\/\1>)<[^<]*)*<\/\1>/gi;

// Noise class/id patterns commonly associated with banners, ads, sidebars, popups
const NOISE_BLOCK_REGEX = /<div\b[^>]*(?:class|id)=["'][^"']*(?:cookie|banner|advert|sidebar|social|popup|modal|widget|footer|newsletter|comment)[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi;

/**
 * Extract title from HTML
 */
function extractTitle(html) {
  const ogTitle = html.match(/<meta\b[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i);
  if (ogTitle && ogTitle[1]) return decodeHtmlEntities(ogTitle[1].trim());

  const titleTag = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  if (titleTag && titleTag[1]) return decodeHtmlEntities(titleTag[1].replace(/<[^>]+>/g, '').trim());

  const h1Tag = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
  if (h1Tag && h1Tag[1]) return decodeHtmlEntities(h1Tag[1].replace(/<[^>]+>/g, '').trim());

  return '';
}

/**
 * Extract description metadata
 */
function extractDescription(html) {
  const metaDesc = html.match(/<meta\b[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i) ||
                   html.match(/<meta\b[^>]*property=["']og:description["'][^>]*content=["']([^"']+)["']/i);
  if (metaDesc && metaDesc[1]) return decodeHtmlEntities(metaDesc[1].trim());
  return '';
}

/**
 * Decode basic HTML entities
 */
export function decodeHtmlEntities(text) {
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
 * Extract main readable text from HTML document
 * @param {string} rawHtml
 * @param {string} url
 * @returns {{ title: string, description: string, mainText: string, length: number }}
 */
export function extractReadableContent(rawHtml, url = '') {
  if (!rawHtml || typeof rawHtml !== 'string') {
    return { title: '', description: '', mainText: '', length: 0 };
  }

  const title = extractTitle(rawHtml);
  const description = extractDescription(rawHtml);

  // 1. Remove all noise tags
  let cleaned = rawHtml.replace(NOISE_TAG_REGEX, ' ');

  // 2. Remove common noise container blocks
  for (let i = 0; i < 3; i++) {
    cleaned = cleaned.replace(NOISE_BLOCK_REGEX, ' ');
  }

  // 3. Priority Container Matching: <article>, <main>, [role="main"], #content, .article
  let mainBodyHtml = '';
  const articleMatch = cleaned.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i);
  const mainMatch = cleaned.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i);
  const roleMainMatch = cleaned.match(/<div\b[^>]*role=["']main["'][^>]*>([\s\S]*?)<\/div>/i);
  const contentDivMatch = cleaned.match(/<div\b[^>]*(?:class|id)=["'][^"']*(?:post-content|article-body|entry-content|main-content|story-content)[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);

  if (articleMatch && articleMatch[1].length > 200) {
    mainBodyHtml = articleMatch[1];
  } else if (mainMatch && mainMatch[1].length > 200) {
    mainBodyHtml = mainMatch[1];
  } else if (roleMainMatch && roleMainMatch[1].length > 200) {
    mainBodyHtml = roleMainMatch[1];
  } else if (contentDivMatch && contentDivMatch[1].length > 200) {
    mainBodyHtml = contentDivMatch[1];
  } else {
    // Fallback to cleaned body or document
    const bodyMatch = cleaned.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i);
    mainBodyHtml = bodyMatch ? bodyMatch[1] : cleaned;
  }

  // 4. Transform HTML structural elements into clean text
  let text = mainBodyHtml
    .replace(/<\/(h[1-6]|p|div|li|tr|blockquote)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<hr\b[^>]*>/gi, '\n---\n')
    .replace(/<[^>]+>/g, ' ');

  text = decodeHtmlEntities(text);

  // 5. Clean up whitespace and empty lines
  const lines = text
    .split('\n')
    .map(line => line.replace(/\s+/g, ' ').trim())
    .filter(line => line.length > 0);

  const mainText = lines.join('\n\n');

  return {
    title,
    description,
    mainText,
    length: mainText.length
  };
}
