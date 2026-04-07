import http from 'http';
import type { ACPMessageEnvelope } from '../acp-types.js';
import type { Channel } from '../core/types.js';
import { type ChannelOpts } from './registry.js';
export declare function buildAcpChatJid(agentId: string, sessionId: string): string;
export declare function normalizeAcpEnvelope(input: unknown, fallbackRole?: ACPMessageEnvelope['role']): ACPMessageEnvelope;
export declare function publishAcpTaskEvent(chatJid: string, event: Record<string, unknown>): Promise<void>;
export declare function maybeHandleAcpRequest(req: http.IncomingMessage, res: http.ServerResponse, url: URL): Promise<boolean>;
export declare class AcpChannel implements Channel {
    name: string;
    private readonly opts;
    private connected;
    constructor(opts: ChannelOpts);
    connect(): Promise<void>;
    sendMessage(jid: string, text: string, _options?: {
        embeds?: any[];
    }): Promise<void>;
    sendFile(jid: string, filePath: string, caption?: string): Promise<void>;
    isConnected(): boolean;
    ownsJid(jid: string): boolean;
    disconnect(): Promise<void>;
}
//# sourceMappingURL=acp.d.ts.map