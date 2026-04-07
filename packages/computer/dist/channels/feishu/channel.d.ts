/**
 * Feishu (飞书 / Lark) channel for Tix.
 * Refactored using AbstractChannel base class.
 */
import * as lark from '@larksuiteoapi/node-sdk';
import { AbstractChannel } from '../base.js';
import { ChannelOpts } from '../registry.js';
interface FeishuAccount {
    appId: string;
    appSecret: string;
    agentId: string;
}
interface FeishuInstance {
    appId: string;
    agentId: string;
    client: lark.Client;
    wsClient: lark.WSClient;
}
export declare class FeishuChannel extends AbstractChannel<FeishuInstance, FeishuAccount> {
    name: string;
    ownsJid(jid: string): boolean;
    constructor(accounts: FeishuAccount[], opts: ChannelOpts);
    protected initInstances(accounts: FeishuAccount[]): void;
    private setupEventHandlers;
    /**
     * Automatically sync CommandHub commands to Feishu Bot Menu.
     */
    private syncBotMenu;
    protected connectInstance(inst: FeishuInstance): Promise<void>;
    protected disconnectInstance(inst: FeishuInstance): Promise<void>;
    protected parseJid(jid: string): {
        channel: string;
        appId: string;
        chatId: string;
    };
    sendMessage(jid: string, text: string, options?: any): Promise<void>;
    sendFile(jid: string, _path: string): Promise<void>;
}
export {};
//# sourceMappingURL=channel.d.ts.map