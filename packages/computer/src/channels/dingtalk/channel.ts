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
import { registerChannel, ChannelOpts } from '../registry.js';
import { parseDingTalkContent, stripDingTalkMentions } from './helpers.js';
import { ConnectionManager } from './connection.js';
import { sendBySession, sendProactiveMessage } from './send.js';

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

export class DingTalkChannel extends AbstractChannel<
  DingTalkInstance,
  DingTalkAccount
> {
  name = 'dingtalk';

  constructor(accounts: DingTalkAccount[], opts: ChannelOpts) {
    super(opts);
    this.initInstances(accounts);
  }

  protected initInstances(accounts: DingTalkAccount[]): void {
    for (const account of accounts) {
      const streamClient = new dingtalkstream.DWClient({
        clientId: account.appId,
        clientSecret: account.appSecret,
      });

      const connectionManager = new ConnectionManager(
        streamClient,
        account.appId,
      );

      (streamClient as any).registerChatReceiver(async (event: any) => {
        const {
          conversationId,
          senderId,
          senderNick,
          content,
          msgId,
          sessionWebhook,
        } = event;
        const chatJid = `dingtalk:${account.appId}:${conversationId}`;

        const inst = this.instances.get(account.appId);
        if (inst) inst.lastWebhook = sessionWebhook;

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

  protected async connectInstance(inst: DingTalkInstance): Promise<void> {
    await inst.connectionManager.connect();
  }

  protected async disconnectInstance(inst: DingTalkInstance): Promise<void> {
    inst.connectionManager.stop();
  }

  async sendMessage(jid: string, text: string, options?: any): Promise<void> {
    const { appId, chatId } = this.parseJid(jid);
    const inst = this.instances.get(appId);
    if (!inst) return;

    if (inst.lastWebhook) {
      await sendBySession(inst.lastWebhook, inst.appId, inst.appSecret, text);
    } else {
      const isGroup = chatId.startsWith('cid');
      await sendProactiveMessage(
        inst.appId,
        inst.appSecret,
        chatId,
        text,
        isGroup,
      );
    }
  }

  async sendFile(jid: string, _path: string): Promise<void> {
    logger.warn('DingTalk sendFile stub');
  }
}

function createDingTalkChannel(opts: ChannelOpts): DingTalkChannel | null {
  const config = readEnvFile(['TIX_DINGTALK_ENABLED', 'TIX_DINGTALK_ACCOUNTS']);
  if (config.TIX_DINGTALK_ENABLED === 'false') return null;

  try {
    const accounts = JSON.parse(config.TIX_DINGTALK_ACCOUNTS || '[]');
    return accounts.length > 0 ? new DingTalkChannel(accounts, opts) : null;
  } catch {
    return null;
  }
}

registerChannel('dingtalk', createDingTalkChannel);
