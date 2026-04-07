import { NewMessage } from './types.js';
export interface GatewayCallbacks {
    onMessage: (chatJid: string, msg: NewMessage) => void;
    onChatMetadata: (chatJid: string, timestamp: string, name?: string, channel?: string, isGroup?: boolean) => void;
}
/**
 * Gateway — the computer's outbound uplink to the Tix Gateway.
 *
 * Architecture:
 *   - Computers connect outward to the gateway and receive instructions from it.
 *   - The gateway accepts connections from controller platforms (Supen, etc.)
 *     that drive the computers via channels (Discord, HTTP, ACP, …).
 *
 * This is core infrastructure, not a consumer channel.
 * Instantiated directly in index.ts, not via the channel registry.
 */
export declare class Gateway {
    private ws;
    private _connected;
    private config;
    private callbacks;
    private reconnectTimeout;
    private reportingInterval;
    private activeSseSubscriptions;
    constructor(callbacks: GatewayCallbacks);
    connect(): Promise<void>;
    private initiateConnection;
    private authenticate;
    /**
     * Build a HMAC token for gateway authentication.
     * Format: `${computerId}.${timestampMs}.${hmacHex}`
     * Only when TIX_GATEWAY_SECRET env var is set on the computer side.
     */
    private buildGatewayToken;
    private startReporting;
    private stopReporting;
    private handleMessage;
    private handleApiRequest;
    private handleSseSubscribe;
    /** Send a message back to the gateway (from a local agent reply). */
    sendMessage(chatJid: string, text: string): Promise<void>;
    /** Check if this JID belongs to a gateway session. */
    ownsJid(jid: string): boolean;
    isConnected(): boolean;
    disconnect(): Promise<void>;
}
//# sourceMappingURL=gateway.d.ts.map