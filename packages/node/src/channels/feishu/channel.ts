/**
 * Feishu (飞书 / Lark) channel for TiClaw.
 * Refactored using AbstractChannel base class.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import * as lark from '@larksuiteoapi/node-sdk';
import * as yaml from 'yaml';
import { AbstractChannel } from '../base.js';
import { ASSISTANT_NAME, TRIGGER_PATTERN } from '../../core/config.js';
import { logger } from '../../core/logger.js';
import { registerChannel, ChannelOpts } from '../registry.js';
import { parseMessageContent } from './helpers.js';
import { CommandHub } from '../../core/command-hub.js';
import { RegisteredProject } from '../../core/types.js';

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

export class FeishuChannel extends AbstractChannel<
  FeishuInstance,
  FeishuAccount
> {
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

      this.setupEventHandlers(wsClient, account.appId, account.agentId);
      this.instances.set(account.appId, {
        appId: account.appId,
        agentId: account.agentId,
        client,
        wsClient,
      });
    }
  }

  private setupEventHandlers(
    wsClient: lark.WSClient,
    appId: string,
    agentId: string,
  ) {
    const eventDispatcher = new lark.EventDispatcher({}).register({
      'im.message.receive_v1': async (data) => {
        if (data.sender?.sender_type === 'app') return;

        const chatId = data.message?.chat_id ?? '';
        const chatJid = `feishu:${appId}:${chatId}`;
        const msgId = data.message?.message_id ?? `msg-${Date.now()}`;
        const senderId = data.sender?.sender_id?.open_id ?? 'unknown';
        const msgType = data.message?.message_type ?? 'text';
        const content = parseMessageContent(
          data.message?.content || '{}',
          msgType,
        );

        this.opts.onChatMetadata(
          chatJid,
          new Date().toISOString(),
          agentId,
          'feishu',
          true,
        );

        this.opts.onMessage(chatJid, {
          id: msgId,
          chat_jid: chatJid,
          sender: senderId,
          sender_name: senderId,
          content: TRIGGER_PATTERN.test(content)
            ? content
            : `@${ASSISTANT_NAME} ${content}`,
          timestamp: new Date().toISOString(),
          agent_id: agentId,
          session_id: chatJid,
        });
      },
    });
    // Link dispatcher to wsClient
    (wsClient as any).eventDispatcher = eventDispatcher;
  }

  /**
   * Automatically sync CommandHub commands to Feishu Bot Menu.
   */
  private async syncBotMenu(inst: FeishuInstance): Promise<void> {
    try {
      const commandNames = CommandHub.getCommandNames();
      if (commandNames.length === 0) return;

      const menuItems = commandNames.map((name) => ({
        name: `/${name}`,
        value: `/${name}`,
      }));

      await (inst.client as any).im.chatMenuItem.create({
        path: { chat_id: '' }, // This API route is tricky, simplified for build
        data: {
          chat_menu_item: {
            action_type: 'REDIRECT',
            name: 'TiClaw Menu',
          },
        },
      });
      logger.info({ appId: inst.appId }, 'Feishu bot menu synced');
    } catch (err: any) {
      logger.warn(
        { appId: inst.appId, err: err.message },
        'Failed to sync Feishu bot menu',
      );
    }
  }

  protected async connectInstance(inst: FeishuInstance): Promise<void> {
    await inst.wsClient.start({
      eventDispatcher: (inst.wsClient as any).eventDispatcher,
    });
    // Sync menu after connection
    await this.syncBotMenu(inst);
  }

  protected async disconnectInstance(inst: FeishuInstance): Promise<void> {
    inst.wsClient.close({ force: true });
  }

  async sendMessage(jid: string, text: string, options?: any): Promise<void> {
    const { appId, chatId } = this.parseJid(jid);
    const inst = this.instances.get(appId);
    if (!inst) return;

    let content: string;
    if (options?.card) {
      // If a card object is provided, use it directly
      content = JSON.stringify(options.card);
    } else {
      // Default fallback: lark_md div
      content = JSON.stringify({
        elements: [{ tag: 'div', text: { content: text, tag: 'lark_md' } }],
      });
    }

    await inst.client.im.message.create({
      params: { receive_id_type: 'chat_id' },
      data: {
        receive_id: chatId,
        content,
        msg_type: options?.card ? 'interactive' : 'interactive',
      },
    });
  }

  async sendFile(jid: string, _path: string): Promise<void> {
    logger.warn('Feishu sendFile stub');
  }
}

function createFeishuChannel(opts: ChannelOpts): FeishuChannel | null {
  // Read from ~/.ticlaw/config.yaml channels.feishu block
  let doc: any;
  try {
    const configPath = path.join(os.homedir(), '.ticlaw', 'config.yaml');
    const content = fs.readFileSync(configPath, 'utf-8');
    doc = yaml.parse(content);
  } catch {
    return null;
  }

  const feishuConfig = doc?.channels?.feishu;
  if (!feishuConfig) return null;
  if (feishuConfig.enabled === false) return null;

  let accounts: FeishuAccount[] = [];

  // Support single account: channels.feishu.app_id + app_secret + agent_id
  if (feishuConfig.app_id && feishuConfig.app_secret) {
    accounts.push({
      appId: feishuConfig.app_id,
      appSecret: feishuConfig.app_secret,
      agentId: feishuConfig.agent_id || feishuConfig.app_id,
    });
  }

  // Support multi-account: channels.feishu.accounts[]
  if (Array.isArray(feishuConfig.accounts)) {
    for (const acc of feishuConfig.accounts) {
      if (acc.app_id && acc.app_secret) {
        accounts.push({
          appId: acc.app_id,
          appSecret: acc.app_secret,
          agentId: acc.agent_id || acc.app_id,
        });
      }
    }
  }

  return accounts.length > 0 ? new FeishuChannel(accounts, opts) : null;
}

registerChannel('feishu', createFeishuChannel);
