/**
 * DingTalk (钉钉) message parsing helpers.
 * Structured similarly to Feishu's high-quality implementation.
 */
export declare function parseDingTalkContent(content: string, type: string): string;
/**
 * Handle Mention Stripping.
 * DingTalk messages in groups often start with @Robot.
 */
export declare function stripDingTalkMentions(text: string, botName: string): string;
//# sourceMappingURL=helpers.d.ts.map