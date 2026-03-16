/**
 * Resolves ticlaw:// protocol URLs used in message content.
 *
 * Format: ticlaw://workspace/{agentId}/{relativePath}
 *
 * The web UI intercepts these custom URLs and resolves them to
 * actual /api/workspace/ HTTP endpoints on demand.
 */

const TICLAW_PROTOCOL = 'ticlaw://workspace/';

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg']);
const VIDEO_EXTS = new Set(['.mp4', '.webm', '.mov']);
const PREVIEW_EXTS = new Set(['.md', '.txt', '.json', '.csv', '.html', '.css', '.js', '.ts', '.py']);

function getExt(filePath: string): string {
  const dot = filePath.lastIndexOf('.');
  return dot >= 0 ? filePath.slice(dot).toLowerCase() : '';
}

/**
 * Parse a ticlaw:// URL into its components.
 */
export function parseTiclawUrl(url: string): { agentId: string; path: string } | null {
  if (!url.startsWith(TICLAW_PROTOCOL)) return null;
  const rest = url.slice(TICLAW_PROTOCOL.length);
  const slashIdx = rest.indexOf('/');
  if (slashIdx < 0) return null;
  return {
    agentId: rest.slice(0, slashIdx),
    path: rest.slice(slashIdx + 1),
  };
}

/**
 * Convert a ticlaw:// URL to an /api/workspace/ HTTP URL.
 */
export function resolveToHttp(ticlawUrl: string): string {
  const parsed = parseTiclawUrl(ticlawUrl);
  if (!parsed) return ticlawUrl;
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
 * Post-process rendered HTML to resolve ticlaw:// URLs.
 *
 * - Images (![alt](ticlaw://...)) → <img> with lazy loading from /api/workspace/
 * - Links ([text](ticlaw://...)) → styled file cards with on-click fetch
 * - Raw ticlaw:// text → clickable file references
 */
export function resolveProtocolUrls(html: string): string {
  // Replace <img src="ticlaw://..."> with real src + lazy loading
  html = html.replace(
    /<img\s+([^>]*?)src="(ticlaw:\/\/workspace\/[^"]+)"([^>]*?)>/gi,
    (_match, before, url, after) => {
      const httpUrl = resolveToHttp(url);
      const parsed = parseTiclawUrl(url);
      const name = parsed ? fileName(parsed.path) : 'image';
      return `<img ${before}src="${httpUrl}" loading="lazy" alt="${name}" data-ticlaw-src="${url}"${after}>`;
    },
  );

  // Replace <a href="ticlaw://..."> with file card rendering
  html = html.replace(
    /<a\s+([^>]*?)href="(ticlaw:\/\/workspace\/[^"]+)"([^>]*?)>(.*?)<\/a>/gi,
    (_match, before, url, after, linkText) => {
      const httpUrl = resolveToHttp(url);
      const parsed = parseTiclawUrl(url);
      const name = parsed ? fileName(parsed.path) : linkText;
      const ext = getExt(name);
      const category = fileCategory(name);

      if (category === 'image') {
        // Image link → render as inline image
        return `<img src="${httpUrl}" loading="lazy" alt="${name}" data-ticlaw-src="${url}" class="ticlaw-file-image">`;
      }

      if (category === 'video') {
        return `<video controls preload="none" data-ticlaw-src="${url}" class="ticlaw-file-video"><source src="${httpUrl}"></video>`;
      }

      // File card for downloads and previewable files
      const icon = category === 'preview' ? '📄' : '📎';
      return `<a ${before}href="${httpUrl}" target="_blank" rel="noopener" data-ticlaw-src="${url}" class="ticlaw-file-card"${after}>${icon} <span class="ticlaw-file-name">${name}</span><span class="ticlaw-file-ext">${ext}</span></a>`;
    },
  );

  // Replace bare ticlaw:// URLs in text (not already in tags)
  html = html.replace(
    /(?<!="|'>)(ticlaw:\/\/workspace\/[^\s<"']+)/gi,
    (url) => {
      const httpUrl = resolveToHttp(url);
      const parsed = parseTiclawUrl(url);
      const name = parsed ? fileName(parsed.path) : url;
      const category = fileCategory(name);
      const icon = category === 'image' ? '🖼️' : category === 'video' ? '🎬' : '📎';
      return `<a href="${httpUrl}" target="_blank" rel="noopener" data-ticlaw-src="${url}" class="ticlaw-file-card">${icon} <span class="ticlaw-file-name">${name}</span></a>`;
    },
  );

  return html;
}
