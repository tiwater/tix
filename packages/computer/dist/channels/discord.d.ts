import { ChannelOpts } from './registry.js';
import { Channel, OnChatMetadata, OnInboundMessage, RegisteredProject } from '../core/types.js';
export interface DiscordChannelOpts extends ChannelOpts {
    onMessage: OnInboundMessage;
    onChatMetadata: OnChatMetadata;
    registeredProjects: () => Record<string, RegisteredProject>;
    onGroupRegistered?: (jid: string, group: RegisteredProject) => void;
}
export declare class DiscordChannel implements Channel {
    name: string;
    private client;
    private opts;
    private botToken;
    private originalHttpsAgent;
    constructor(botToken: string, opts: DiscordChannelOpts);
    connect(): Promise<void>;
    sendMessage(jid: string, text: string, options?: {
        embeds?: any[];
    }): Promise<void>;
    private typingIntervals;
    setTyping(jid: string, isTyping: boolean): Promise<void>;
    sendFile(jid: string, filePath: string, caption?: string): Promise<void>;
    isConnected(): boolean;
    ownsJid(jid: string): boolean;
    disconnect(): Promise<void>;
    createChannel(fromJid: string, channelName: string): Promise<string | null>;
    sendMessageReturningId(jid: string, text: string): Promise<string | null>;
    editMessage(jid: string, messageId: string, text: string): Promise<void>;
    channelExists(jid: string): Promise<boolean>;
}
//# sourceMappingURL=discord.d.ts.map