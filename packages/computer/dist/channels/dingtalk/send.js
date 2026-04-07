/**
 * DingTalk Message Sending Service.
 * Adapted from OpenTix's high-quality send-service implementation.
 */
import axios from 'axios';
import { getAccessToken } from './auth.js';
const DINGTALK_TEXT_CHUNK_LIMIT = 3800;
/**
 * Detect if text is Markdown and extract title.
 */
function detectMarkdownAndExtractTitle(text) {
    // Simple heuristic: check for common markdown chars
    const markdownIndicators = ['#', '**', '[', '](', '```', '- ', '* '];
    const isMarkdown = markdownIndicators.some((indicator) => text.includes(indicator));
    let title = 'Tix 消息';
    if (isMarkdown && text.startsWith('# ')) {
        const firstLine = text.split('\n')[0];
        title = firstLine.replace(/^#\s*/, '').slice(0, 50);
    }
    return { useMarkdown: isMarkdown, title };
}
/**
 * Split long markdown into chunks.
 */
function splitMarkdownChunks(text, limit = DINGTALK_TEXT_CHUNK_LIMIT) {
    if (!text || text.length <= limit)
        return [text];
    const chunks = [];
    let buf = '';
    const lines = text.split('\n');
    for (const line of lines) {
        if (buf.length + line.length + 1 > limit && buf.length > 0) {
            chunks.push(buf);
            buf = '';
        }
        buf += (buf ? '\n' : '') + line;
    }
    if (buf)
        chunks.push(buf);
    return chunks;
}
/**
 * Send message via session webhook (reply context).
 */
export async function sendBySession(sessionWebhook, clientId, clientSecret, text, options = {}) {
    const { log } = options;
    const token = await getAccessToken(clientId, clientSecret, log);
    const { useMarkdown, title } = detectMarkdownAndExtractTitle(text);
    const chunks = splitMarkdownChunks(text, DINGTALK_TEXT_CHUNK_LIMIT);
    for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        let body;
        if (useMarkdown) {
            const chunkTitle = chunks.length > 1 ? `${title} (${i + 1}/${chunks.length})` : title;
            body = {
                msgtype: 'markdown',
                markdown: { title: chunkTitle, text: chunk },
            };
        }
        else {
            body = {
                msgtype: 'text',
                text: { content: chunk },
            };
        }
        try {
            await axios({
                url: sessionWebhook,
                method: 'POST',
                data: body,
                headers: {
                    'x-acs-dingtalk-access-token': token,
                    'Content-Type': 'application/json',
                },
            });
        }
        catch (err) {
            log?.error?.(`[DingTalk] Send failed: ${err.message}`);
            throw err;
        }
    }
}
/**
 * Send proactive message (to conversationId directly, not via sessionWebhook).
 */
export async function sendProactiveMessage(clientId, clientSecret, target, // conversationId or userId
text, isGroup, options = {}) {
    const { log } = options;
    const token = await getAccessToken(clientId, clientSecret, log);
    const { useMarkdown, title } = detectMarkdownAndExtractTitle(text);
    const url = isGroup
        ? 'https://api.dingtalk.com/v1.0/robot/groupMessages/send'
        : 'https://api.dingtalk.com/v1.0/robot/oToMessages/batchSend';
    const msgKey = useMarkdown ? 'sampleMarkdown' : 'sampleText';
    const msgParam = useMarkdown
        ? JSON.stringify({ title, text })
        : JSON.stringify({ content: text });
    const payload = {
        robotCode: clientId,
        msgKey,
        msgParam,
    };
    if (isGroup) {
        payload.openConversationId = target;
    }
    else {
        payload.userIds = [target];
    }
    try {
        await axios({
            url,
            method: 'POST',
            data: payload,
            headers: {
                'x-acs-dingtalk-access-token': token,
                'Content-Type': 'application/json',
            },
        });
        log?.info?.(`[DingTalk] Proactive message sent to ${target}`);
    }
    catch (err) {
        log?.error?.(`[DingTalk] Proactive send failed: ${err.message}`);
        throw err;
    }
}
//# sourceMappingURL=send.js.map