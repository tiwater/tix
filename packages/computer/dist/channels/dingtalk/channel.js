/**
 * DingTalk (钉钉) channel for Tix.
 * Multi-account support via DingTalk Stream Mode.
 * Adapted from OpenTix's high-quality implementation.
 */
import * as dingtalkstream from 'dingtalk-stream';
import { AbstractChannel } from '../base.js';
import { ASSISTANT_NAME, TRIGGER_PATTERN } from '../../core/config.js';
import { readEnvFile } from '../../core/env.js';
import { logger } from '../../core/logger.js';
import { registerChannel } from '../registry.js';
import { parseDingTalkContent, stripDingTalkMentions } from './helpers.js';
import { ConnectionManager } from './connection.js';
import { sendBySession, sendProactiveMessage } from './send.js';
export class DingTalkChannel extends AbstractChannel {
    name = 'dingtalk';
    constructor(accounts, opts) {
        super(opts);
        this.initInstances(accounts);
    }
    initInstances(accounts) {
        for (const account of accounts) {
            const streamClient = new dingtalkstream.DWClient({
                clientId: account.appId,
                clientSecret: account.appSecret,
            });
            const connectionManager = new ConnectionManager(streamClient, account.appId);
            streamClient.registerChatReceiver(async (event) => {
                const { conversationId, senderId, senderNick, content, msgId, sessionWebhook, } = event;
                const chatJid = `dingtalk:${account.appId}:${conversationId}`;
                const inst = this.instances.get(account.appId);
                if (inst)
                    inst.lastWebhook = sessionWebhook;
                let text = parseDingTalkContent(content, 'plaintext');
                text = stripDingTalkMentions(text, ASSISTANT_NAME);
                this.opts.onMessage(chatJid, {
                    id: msgId,
                    chat_jid: chatJid,
                    sender: senderId,
                    sender_name: senderNick,
                    content: TRIGGER_PATTERN.test(text)
                        ? text
                        : `@${ASSISTANT_NAME} ${text}`,
                    timestamp: new Date().toISOString(),
                });
                return { status: 'ok' };
            });
            this.instances.set(account.appId, {
                appId: account.appId,
                appSecret: account.appSecret,
                streamClient,
                connectionManager,
            });
        }
    }
    async connectInstance(inst) {
        await inst.connectionManager.connect();
    }
    async disconnectInstance(inst) {
        inst.connectionManager.stop();
    }
    async sendMessage(jid, text, options) {
        const { appId, chatId } = this.parseJid(jid);
        const inst = this.instances.get(appId);
        if (!inst)
            return;
        if (inst.lastWebhook) {
            await sendBySession(inst.lastWebhook, inst.appId, inst.appSecret, text);
        }
        else {
            const isGroup = chatId.startsWith('cid');
            await sendProactiveMessage(inst.appId, inst.appSecret, chatId, text, isGroup);
        }
    }
    async sendFile(jid, _path) {
        logger.warn('DingTalk sendFile stub');
    }
}
function createDingTalkChannel(opts) {
    const config = readEnvFile(['TIX_DINGTALK_ENABLED', 'TIX_DINGTALK_ACCOUNTS']);
    if (config.TIX_DINGTALK_ENABLED === 'false')
        return null;
    try {
        const accounts = JSON.parse(config.TIX_DINGTALK_ACCOUNTS || '[]');
        return accounts.length > 0 ? new DingTalkChannel(accounts, opts) : null;
    }
    catch {
        return null;
    }
}
registerChannel('dingtalk', createDingTalkChannel);
//# sourceMappingURL=channel.js.map