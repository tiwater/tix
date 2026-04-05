/**
 * DingTalk (钉钉) message parsing helpers.
 * Structured similarly to Feishu's high-quality implementation.
 */

const FALLBACK_DING_TEXT = '[DingTalk message]';

export function parseDingTalkContent(content: string, type: string): string {
  // DingTalk often delivers content as a JSON string
  try {
    const parsed = JSON.parse(content);
    if (type === 'text') return parsed.content || content;
    if (type === 'markdown') return parsed.text || parsed.content || content;
    return content;
  } catch {
    return content;
  }
}

/**
 * Handle Mention Stripping.
 * DingTalk messages in groups often start with @Robot.
 */
export function stripDingTalkMentions(text: string, botName: string): string {
  const atPattern = new RegExp(`@${botName}\\s*`, 'g');
  return text.replace(atPattern, '').trim();
}
