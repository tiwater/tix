import './channels/index.js';
import { AvailableProject, NewMessage, RegisteredProject } from './core/types.js';
export interface ChannelOpts {
    onMessage: (chatJid: string, msg: NewMessage) => void;
    onChatMetadata: (chatJid: string, timestamp: string, name?: string, channel?: string, isGroup?: boolean) => void;
    registeredProjects: () => Record<string, RegisteredProject>;
    onGroupRegistered: (jid: string, group: RegisteredProject) => void;
    onSessionStop?: (agentId: string, sessionId: string, actor?: string) => {
        ok: boolean;
        code: string;
        message: string;
        chatJid?: string;
    };
}
export declare function getAvailableProjects(): AvailableProject[];
/** @internal - for tests only. */
export declare function _setRegisteredProjects(groups: Record<string, RegisteredProject>): void;
export interface TixComputerConfig {
    productName?: string;
    dataDir?: string;
}
export declare class TixComputer {
    constructor(config?: TixComputerConfig);
    start(): Promise<void>;
}
//# sourceMappingURL=index.d.ts.map