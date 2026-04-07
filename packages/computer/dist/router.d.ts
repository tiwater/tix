import { Channel } from './core/types.js';
export declare function stripInternalTags(text: string): string;
export declare function formatOutbound(rawText: string): string;
export declare function routeOutbound(channels: Channel[], jid: string, text: string, options?: {
    embeds?: any[];
    message_id?: string;
}): Promise<void>;
export declare function routeSendReturningId(channels: Channel[], jid: string, text: string): Promise<string | null>;
export declare function routeEditMessage(channels: Channel[], jid: string, messageId: string, text: string): Promise<void>;
export declare function routeOutboundFile(channels: Channel[], jid: string, filePath: string, caption?: string): Promise<void>;
export declare function routeSetTyping(channels: Channel[], jid: string, isTyping: boolean): Promise<void> | void;
export declare function findChannel(channels: Channel[], jid: string): Channel | undefined;
//# sourceMappingURL=router.d.ts.map