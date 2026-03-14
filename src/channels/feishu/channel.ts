/**
 * Feishu (飞书 / Lark) channel for TiClaw.
 * Refactored using AbstractChannel base class.
 */

import * as lark from '@larksuiteoapi/node-sdk';
import { AbstractChannel } from '../base.js';
import { ASSISTANT_NAME, TRIGGER_PATTERN } from '../../core/config.js';
import { readEnvFile } from '../../core/env.js';
import { logger } from '../../core/logger.js';
import { registerChannel, ChannelOpts } from '../registry.js';
import { parseMessageContent } from './helpers.js';
import {
  RegisteredProject,
} from '../../core/types.js';

interface FeishuAccount {
  appId: string;
  appSecret: string;
}

interface FeishuInstance {
  appId: string;
  client: lark.Client;
  wsClient: lark.WSClient;
}

export class FeishuChannel extends AbstractChannel<FeishuInstance, FeishuAccount> {
  name = 'feishu';

  constructor(accounts: FeishuAccount[], opts: ChannelOpts) {
    super(opts);
    this.initInstances(accounts);
  }

  protected initInstances(accounts: FeishuAccount[]): void {
    for (const account of accounts) {
      const client = new lark.Client({
        appId: account.appId,
        appSecret: account.appSecret,
        appType: lark.AppType.SelfBuild,
        domain: lark.Domain.Feishu,
      });

      const wsClient = new lark.WSClient({
        appId: account.appId,
        appSecret: account.appSecret,
      });

      this.setupEventHandlers(wsClient, account.appId);
      this.instances.set(account.appId, { appId: account.appId, client, wsClient });
    }
  }

  private setupEventHandlers(wsClient: lark.WSClient, appId: string) {
    const eventDispatcher = new lark.EventDispatcher({}).register({
      'im.message.receive_v1': async (data) => {
        if (data.sender?.sender_type === 'app') return;

        const chatId = data.message?.chat_id ?? '';
        const chatJid = `feishu:${appId}:${chatId}`;
        const msgId = data.message?.message_id ?? `msg-${Date.now()}`;
        const senderId = data.sender?.sender_id?.open_id ?? 'unknown';
        const msgType = data.message?.message_type ?? 'text';
        const content = parseMessageContent(data.message?.content || '{}', msgType);

        this.opts.onChatMetadata(chatJid, new Date().toISOString(), undefined, 'feishu', true);
        
        this.opts.onMessage(chatJid, {
          id: msgId,
          chat_jid: chatJid,
          sender: senderId,
          sender_name: senderId, // Default to ID, could be resolved
          content: TRIGGER_PATTERN.test(content) ? content : `@${ASSISTANT_NAME} ${content}`,
          timestamp: new Date().toISOString(),
        });
      },
    });
    // Link dispatcher to wsClient
    (wsClient as any).eventDispatcher = eventDispatcher; 
  }

  protected async connectInstance(inst: FeishuInstance): Promise<void> {
    await inst.wsClient.start({ eventDispatcher: (inst.wsClient as any).eventDispatcher });
  }

  protected async disconnectInstance(inst: FeishuInstance): Promise<void> {
    inst.wsClient.close({ force: true });
  }

  async sendMessage(jid: string, text: string): Promise<void> {
    const { appId, chatId } = this.parseJid(jid);
    const inst = this.instances.get(appId);
    if (!inst) return;

    await inst.client.im.message.create({
      params: { receive_id_type: 'chat_id' },
      data: {
        receive_id: chatId,
        content: JSON.stringify({
          elements: [{ tag: 'div', text: { content: text, tag: 'lark_md' } }]
        }),
        msg_type: 'interactive',
      },
    });
  }

  async sendFile(jid: string, _path: string): Promise<void> {
    logger.warn('Feishu sendFile stub');
  }
}

function createFeishuChannel(opts: ChannelOpts): FeishuChannel | null {
  const config = readEnvFile(['TC_FEISHU_ENABLED', 'TC_FEISHU_ACCOUNTS']);
  if (config.TC_FEISHU_ENABLED === 'false') return null;

  try {
    const accounts = JSON.parse(config.TC_FEISHU_ACCOUNTS || '[]');
    return accounts.length > 0 ? new FeishuChannel(accounts, opts) : null;
  } catch {
    return null;
  }
}

registerChannel('feishu', createFeishuChannel);
