/**
 * DingTalk Message Sending Service.
 * Adapted from OpenTix's high-quality send-service implementation.
 */
interface SendOptions {
    log?: any;
    accountId?: string;
}
/**
 * Send message via session webhook (reply context).
 */
export declare function sendBySession(sessionWebhook: string, clientId: string, clientSecret: string, text: string, options?: SendOptions): Promise<void>;
/**
 * Send proactive message (to conversationId directly, not via sessionWebhook).
 */
export declare function sendProactiveMessage(clientId: string, clientSecret: string, target: string, // conversationId or userId
text: string, isGroup: boolean, options?: SendOptions): Promise<void>;
export {};
//# sourceMappingURL=send.d.ts.map