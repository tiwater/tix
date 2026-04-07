/**
 * Feishu (飞书 / Lark) message parsing helpers.
 * Adapted from OpenTix's robust Feishu implementation.
 */
const FALLBACK_POST_TEXT = '[Rich text message]';
const MARKDOWN_SPECIAL_CHARS = /([\\`*_{}\[\]()#+\-!|>~])/g;
function isRecord(value) {
    return typeof value === 'object' && value !== null;
}
function toStringOrEmpty(value) {
    return typeof value === 'string' ? value : '';
}
function escapeMarkdownText(text) {
    return text.replace(MARKDOWN_SPECIAL_CHARS, '\\$1');
}
function isStyleEnabled(style, key) {
    if (!style)
        return false;
    const value = style[key];
    return value === true || value === 1 || value === 'true';
}
function wrapInlineCode(text) {
    const maxRun = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));
    const fence = '`'.repeat(maxRun + 1);
    const needsPadding = text.startsWith('`') || text.endsWith('`');
    const body = needsPadding ? ` ${text} ` : text;
    return `${fence}${body}${fence}`;
}
function renderTextElement(element) {
    const text = toStringOrEmpty(element.text);
    const style = isRecord(element.style) ? element.style : undefined;
    if (isStyleEnabled(style, 'code'))
        return wrapInlineCode(text);
    let rendered = escapeMarkdownText(text);
    if (!rendered)
        return '';
    if (isStyleEnabled(style, 'bold'))
        rendered = `**${rendered}**`;
    if (isStyleEnabled(style, 'italic'))
        rendered = `*${rendered}*`;
    return rendered;
}
function renderElement(element, imageKeys, mediaKeys, mentionedOpenIds) {
    if (!isRecord(element))
        return escapeMarkdownText(toStringOrEmpty(element));
    const tag = toStringOrEmpty(element.tag).toLowerCase();
    switch (tag) {
        case 'text':
            return renderTextElement(element);
        case 'a':
            const href = toStringOrEmpty(element.href).trim();
            const text = toStringOrEmpty(element.text) || href;
            return href
                ? `[${escapeMarkdownText(text)}](${href})`
                : escapeMarkdownText(text);
        case 'at':
            const uid = toStringOrEmpty(element.open_id) || toStringOrEmpty(element.user_id);
            if (uid)
                mentionedOpenIds.push(uid);
            return `@${escapeMarkdownText(toStringOrEmpty(element.user_name) || uid)}`;
        case 'img':
            const imgKey = toStringOrEmpty(element.image_key);
            if (imgKey)
                imageKeys.push(imgKey);
            return '![image]';
        case 'br':
            return '\n';
        default:
            return escapeMarkdownText(toStringOrEmpty(element.text));
    }
}
export function parsePostContent(content) {
    try {
        const parsed = JSON.parse(content);
        let payload = parsed;
        // 1. Handle "post" wrapper
        if (parsed.post)
            payload = parsed.post;
        // 2. Handle nested locales (like zh_cn, en_us)
        const keys = Object.keys(payload);
        if (keys.length > 0 && !Array.isArray(payload.content)) {
            // Heuristic: if first key is a locale-like string and its value has 'content'
            const firstVal = payload[keys[0]];
            if (isRecord(firstVal) && Array.isArray(firstVal.content)) {
                payload = firstVal;
            }
        }
        if (!payload || !Array.isArray(payload.content)) {
            return {
                textContent: FALLBACK_POST_TEXT,
                imageKeys: [],
                mediaKeys: [],
                mentionedOpenIds: [],
            };
        }
        const imageKeys = [];
        const mediaKeys = [];
        const mentionedOpenIds = [];
        const paragraphs = [];
        for (const paragraph of payload.content) {
            if (!Array.isArray(paragraph))
                continue;
            let renderedParagraph = '';
            for (const element of paragraph) {
                renderedParagraph += renderElement(element, imageKeys, mediaKeys, mentionedOpenIds);
            }
            paragraphs.push(renderedParagraph);
        }
        const textContent = [payload.title, paragraphs.join('\n')]
            .filter(Boolean)
            .join('\n\n')
            .trim();
        return {
            textContent: textContent || FALLBACK_POST_TEXT,
            imageKeys,
            mediaKeys,
            mentionedOpenIds,
        };
    }
    catch {
        return {
            textContent: FALLBACK_POST_TEXT,
            imageKeys: [],
            mediaKeys: [],
            mentionedOpenIds: [],
        };
    }
}
export function parseMessageContent(content, type) {
    if (type === 'post')
        return parsePostContent(content).textContent;
    try {
        const parsed = JSON.parse(content);
        return parsed.text || parsed.content || content;
    }
    catch {
        return content;
    }
}
//# sourceMappingURL=helpers.js.map