/**
 * Base Abstract Channel for Tix.
 * Handles Multi-account management and JID-based routing.
 */
import { Channel, ChannelOpts } from '../core/types.js';
export declare abstract class AbstractChannel<TInstance, TAccountConfig> implements Channel {
    abstract name: string;
    protected instances: Map<string, TInstance>;
    protected opts: ChannelOpts;
    constructor(opts: ChannelOpts);
    /** Initialize instances from a list of account configurations. */
    protected abstract initInstances(accounts: TAccountConfig[]): void;
    /** Physical connection logic for all instances. */
    connect(): Promise<void>;
    protected abstract connectInstance(instance: TInstance): Promise<void>;
    protected abstract disconnectInstance(instance: TInstance): Promise<void>;
    /** Common JID Parser: {channel}:{app_id}:{chat_id} */
    protected parseJid(jid: string): {
        channel: string;
        appId: string;
        chatId: string;
    };
    /** Implementation of Tix Channel Interface */
    disconnect(): Promise<void>;
    isConnected(): boolean;
    ownsJid(jid: string): boolean;
    /** Delegate to concrete implementations */
    abstract sendMessage(jid: string, text: string, options?: any): Promise<void>;
    abstract sendFile(jid: string, filePath: string, caption?: string): Promise<void>;
    /** New: Return real-time status of all managed app instances. */
    getInstancesStatus(): Array<{
        appId: string;
        connected: boolean;
        lastActivity: string;
        accountLabel?: string;
    }>;
}
//# sourceMappingURL=base.d.ts.map