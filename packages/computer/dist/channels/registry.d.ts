import { Channel, OnInboundMessage, OnChatMetadata, RegisteredProject } from '../core/types.js';
export interface ChannelOpts {
    onMessage: OnInboundMessage;
    onChatMetadata: OnChatMetadata;
    registeredProjects: () => Record<string, RegisteredProject>;
    onGroupRegistered?: (jid: string, group: RegisteredProject) => void;
    onSessionStop?: (agentId: string, sessionId: string, actor?: string) => {
        ok: boolean;
        code: string;
        message: string;
        chatJid?: string;
    };
}
export type ChannelFactory = (opts: ChannelOpts) => Channel | null;
export declare function registerChannel(name: string, factory: ChannelFactory): void;
export declare function getChannelFactory(name: string): ChannelFactory | undefined;
export declare function getRegisteredChannelNames(): string[];
//# sourceMappingURL=registry.d.ts.map