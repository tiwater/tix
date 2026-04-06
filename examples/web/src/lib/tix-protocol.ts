/**
 * Resolves tix:// protocol URLs used in message content.
 *
 * Format: tix://workspace/{agentId}/{relativePath}
 *
 * The web UI intercepts these custom URLs and resolves them to
 * actual /api/workspace/ HTTP endpoints on demand.
 */

const TIX_PROTOCOL = 'tix://workspace/';

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg']);
const VIDEO_EXTS = new Set(['.mp4', '.webm', '.mov']);
const PREVIEW_EXTS = new Set(['.md', '.txt', '.json', '.csv', '.html', '.css', '.js', '.ts', '.py']);

function getExt(filePath: string): string {
  const dot = filePath.lastIndexOf('.');
  return dot >= 0 ? filePath.slice(dot).toLowerCase() : '';
}

/**
 * Parse a tix:// URL into its components.
 */
export function parseTixUrl(url: string): { agentId: string; path: string } | null {
  if (!url.startsWith(TIX_PROTOCOL)) return null;
  const rest = url.slice(TIX_PROTOCOL.length);
  const slashIdx = rest.indexOf('/');
  if (slashIdx < 0) return null;
  return {
    agentId: rest.slice(0, slashIdx),
    path: rest.slice(slashIdx + 1),
  };
}

/**
 * Convert a tix:// URL to an /api/workspace/ HTTP URL.
 */
export function resolveToHttp(tixUrl: string): string {
  const parsed = parseTixUrl(tixUrl);
  if (!parsed) return tixUrl;
  return `/api/workspace/${encodeURIComponent(parsed.path)}?agent_id=${encodeURIComponent(parsed.agentId)}`;
}

/**
 * Determine the file type category for rendering decisions.
 */
export function fileCategory(filePath: string): 'image' | 'video' | 'preview' | 'download' {
  const ext = getExt(filePath);
  if (IMAGE_EXTS.has(ext)) return 'image';
  if (VIDEO_EXTS.has(ext)) return 'video';
  if (PREVIEW_EXTS.has(ext)) return 'preview';
  return 'download';
}

/**
 * Get a human-readable file name from a path.
 */
export function fileName(filePath: string): string {
  const parts = filePath.split('/');
  return parts[parts.length - 1] || filePath;
}

/**
 * Post-process rendered HTML to resolve tix:// URLs.
 *
 * - Images (![alt](tix://...)) → <img> with lazy loading from /api/workspace/
 * - Links ([text](tix://...)) → styled file cards with on-click fetch
 * - Raw tix:// text → clickable file references
 */
export function resolveProtocolUrls(html: string): string {
  // Replace <img src="tix://..."> with real src + lazy loading
  html = html.replace(
    /<img\s+([^>]*?)src="(tix:\/\/workspace\/[^"]+)"([^>]*?)>/gi,
    (_match, before, url, after) => {
      const httpUrl = resolveToHttp(url);
      const parsed = parseTixUrl(url);
      const name = parsed ? fileName(parsed.path) : 'image';
      return `<img ${before}src="${httpUrl}" loading="lazy" alt="${name}" data-tix-src="${url}"${after}>`;
    },
  );

  // Replace <a href="tix://..."> with file card rendering
  html = html.replace(
    /<a\s+([^>]*?)href="(tix:\/\/workspace\/[^"]+)"([^>]*?)>(.*?)<\/a>/gi,
    (_match, before, url, after, linkText) => {
      const httpUrl = resolveToHttp(url);
      const parsed = parseTixUrl(url);
      const name = parsed ? fileName(parsed.path) : linkText;
      const ext = getExt(name);
      const category = fileCategory(name);

      if (category === 'image') {
        // Image link → render as inline image
        return `<img src="${httpUrl}" loading="lazy" alt="${name}" data-tix-src="${url}" class="tix-file-image">`;
      }

      if (category === 'video') {
        return `<video controls preload="none" data-tix-src="${url}" class="tix-file-video"><source src="${httpUrl}"></video>`;
      }

      // File card for downloads and previewable files
      const icon = category === 'preview' ? '📄' : '📎';
      return `<a ${before}href="${httpUrl}" target="_blank" rel="noopener" data-tix-src="${url}" class="tix-file-card"${after}>${icon} <span class="tix-file-name">${name}</span><span class="tix-file-ext">${ext}</span></a>`;
    },
  );

  // Replace bare tix:// URLs in text (not already in tags)
  html = html.replace(
    /(?<!="|'>)(tix:\/\/workspace\/[^\s<"']+)/gi,
    (url) => {
      const httpUrl = resolveToHttp(url);
      const parsed = parseTixUrl(url);
      const name = parsed ? fileName(parsed.path) : url;
      const category = fileCategory(name);
      const icon = category === 'image' ? '🖼️' : category === 'video' ? '🎬' : '📎';
      return `<a href="${httpUrl}" target="_blank" rel="noopener" data-tix-src="${url}" class="tix-file-card">${icon} <span class="tix-file-name">${name}</span></a>`;
    },
  );

  return html;
}
