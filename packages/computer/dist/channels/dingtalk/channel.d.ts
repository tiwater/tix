/**
 * DingTalk (钉钉) channel for Tix.
 * Multi-account support via DingTalk Stream Mode.
 * Adapted from OpenTix's high-quality implementation.
 */
import * as dingtalkstream from 'dingtalk-stream';
import { AbstractChannel } from '../base.js';
import { ChannelOpts } from '../registry.js';
import { ConnectionManager } from './connection.js';
interface DingTalkAccount {
    appId: string;
    appSecret: string;
}
interface DingTalkInstance {
    appId: string;
    appSecret: string;
    streamClient: dingtalkstream.DWClient;
    connectionManager: ConnectionManager;
    lastWebhook?: string;
}
export declare class DingTalkChannel extends AbstractChannel<DingTalkInstance, DingTalkAccount> {
    name: string;
    constructor(accounts: DingTalkAccount[], opts: ChannelOpts);
    protected initInstances(accounts: DingTalkAccount[]): void;
    protected connectInstance(inst: DingTalkInstance): Promise<void>;
    protected disconnectInstance(inst: DingTalkInstance): Promise<void>;
    sendMessage(jid: string, text: string, options?: any): Promise<void>;
    sendFile(jid: string, _path: string): Promise<void>;
}
export {};
//# sourceMappingURL=channel.d.ts.map