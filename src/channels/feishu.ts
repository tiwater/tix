/**
 * Feishu (飞书 / Lark) channel for TiClaw.
 * Uses long connection (WebSocket) to receive events — no public URL needed.
 * JID format: fs:{chat_id}
 */

import * as lark from '@larksuiteoapi/node-sdk';

import { ASSISTANT_NAME, TRIGGER_PATTERN } from '../core/config.js';
import { readEnvFile } from '../core/env.js';
import { logger } from '../core/logger.js';
import { registerChannel, ChannelOpts } from './registry.js';
import {
  Channel,
  OnChatMetadata,
  OnInboundMessage,
  RegisteredProject,
} from '../core/types.js';

const FEISHU_JID_PREFIX = 'fs:';

/** Sanitize Feishu chat_id to valid group folder (A-Za-z0-9_- max 64 chars). */
function toGroupFolder(chatId: string, prefix: string): string {
  const sanitized = chatId.replace(/[^A-Za-z0-9_-]/g, '_');
  const folder = `${prefix}${sanitized}`.slice(0, 64);
  return folder || 'feishu-default';
}

export interface FeishuChannelOpts extends ChannelOpts {
  onMessage: OnInboundMessage;
  onChatMetadata: OnChatMetadata;
  registeredProjects: () => Record<string, RegisteredProject>;
  onGroupRegistered?: (jid: string, group: RegisteredProject) => void;
}

export class FeishuChannel implements Channel {
  name = 'feishu';

  private client: lark.Client | null = null;
  private wsClient: lark.WSClient | null = null;
  private opts: FeishuChannelOpts;
  private appId: string;
  private appSecret: string;
  private _connected = false;

  constructor(appId: string, appSecret: string, opts: FeishuChannelOpts) {
    this.appId = appId;
    this.appSecret = appSecret;
    this.opts = opts;
  }

  async connect(): Promise<void> {
    this.client = new lark.Client({
      appId: this.appId,
      appSecret: this.appSecret,
      appType: lark.AppType.SelfBuild,
      domain: lark.Domain.Feishu,
    });

    const eventDispatcher = new lark.EventDispatcher({}).register({
      'im.message.receive_v1': async (data) => {
        // Ignore messages from apps (our own bot)
        if (data.sender?.sender_type === 'app') return;

        const chatId = data.message?.chat_id ?? '';
        const chatJid = `${FEISHU_JID_PREFIX}${chatId}`;
        const msgId = data.message?.message_id ?? `msg-${Date.now()}`;
        const senderId =
          data.sender?.sender_id?.user_id ??
          data.sender?.sender_id?.open_id ??
          'unknown';

        let content = '';
        try {
          const parsed = JSON.parse(data.message?.content || '{}');
          content = parsed.text ?? parsed.content ?? '';
        } catch {
          content = String(data.message?.content || '');
        }

        const timestamp = new Date().toISOString();
        const chatType = data.message?.chat_type ?? 'p2p';
        const isGroup = chatType === 'group' || chatType === 'group_chat';

        // Sender name: event may include it; otherwise use sender_id
        const senderName = senderId;

        // Ensure trigger for processing
        if (!TRIGGER_PATTERN.test(content)) {
          content = `@${ASSISTANT_NAME} ${content}`;
        }

        this.opts.onChatMetadata(
          chatJid,
          timestamp,
          undefined,
          'feishu',
          isGroup,
        );

        let group = this.opts.registeredProjects()[chatJid];
        if (!group) {
          logger.info({ chatJid }, 'Auto-registering Feishu chat on message');
          const newGroup: RegisteredProject = {
            name: isGroup ? `feishu-${chatId}` : senderName,
            folder: isGroup
              ? toGroupFolder(chatId, 'fs-')
              : toGroupFolder(senderId, 'fs-dm-'),
            trigger: `@${ASSISTANT_NAME}`,
            added_at: new Date().toISOString(),
            requiresTrigger: false,
            isMain: false,
          };
          if (this.opts.onGroupRegistered) {
            this.opts.onGroupRegistered(chatJid, newGroup);
          }
          group = newGroup;
        }

        this.opts.onMessage(chatJid, {
          id: msgId,
          chat_jid: chatJid,
          sender: senderId,
          sender_name: senderName,
          content,
          timestamp,
          is_from_me: false,
        });

        logger.info(
          { chatJid, sender: senderName, content: content.slice(0, 50) },
          'Feishu message received',
        );
      },
    });

    this.wsClient = new lark.WSClient({
      appId: this.appId,
      appSecret: this.appSecret,
      loggerLevel: lark.LoggerLevel.info,
    });

    await this.wsClient.start({ eventDispatcher });
    this._connected = true;
    logger.info('Feishu long connection established (no public URL needed)');
    console.log(`\n  Feishu: long connection active\n`);
  }

  async sendMessage(
    jid: string,
    text: string,
    _options?: { embeds?: any[] },
  ): Promise<void> {
    if (!this.client) {
      logger.warn('Feishu client not initialized');
      return;
    }

    const chatId = jid.replace(new RegExp(`^${FEISHU_JID_PREFIX}`), '');
    if (!chatId) {
      logger.warn({ jid }, 'Invalid Feishu JID');
      return;
    }

    try {
      // Use interactive card with lark_md so Feishu renders markdown (bold, links, code, etc.)
      const cardContent = {
        elements: [
          {
            tag: 'div',
            text: {
              content: text,
              tag: 'lark_md',
            },
          },
        ],
      };
      await this.client.im.message.create({
        params: { receive_id_type: 'chat_id' },
        data: {
          receive_id: chatId,
          content: JSON.stringify(cardContent),
          msg_type: 'interactive',
        },
      });
      logger.info(
        { jid, length: text.length },
        'Feishu message sent (markdown)',
      );
    } catch (err) {
      logger.error({ jid, err }, 'Failed to send Feishu message');
    }
  }

  async sendFile(
    jid: string,
    _filePath: string,
    _caption?: string,
  ): Promise<void> {
    logger.warn({ jid }, 'Feishu sendFile not implemented');
  }

  isConnected(): boolean {
    return this._connected && this.wsClient !== null;
  }

  ownsJid(jid: string): boolean {
    return jid.startsWith(FEISHU_JID_PREFIX);
  }

  async disconnect(): Promise<void> {
    this._connected = false;
    if (this.wsClient) {
      this.wsClient.close({ force: true });
      this.wsClient = null;
    }
    this.client = null;
    logger.info('Feishu channel disconnected');
  }
}

function createFeishuChannel(opts: ChannelOpts): FeishuChannel | null {
  const config = readEnvFile([
    'TC_FEISHU_APP_ID',
    'TC_FEISHU_APP_SECRET',
    'TC_FEISHU_ENABLED',
  ]);

  const enabled =
    process.env.TC_FEISHU_ENABLED !== 'false' &&
    process.env.TC_FEISHU_ENABLED !== '0' &&
    config.TC_FEISHU_ENABLED !== 'false' &&
    config.TC_FEISHU_ENABLED !== '0';
  if (!enabled) return null;

  const appId = process.env.TC_FEISHU_APP_ID || config.TC_FEISHU_APP_ID;
  const appSecret =
    process.env.TC_FEISHU_APP_SECRET || config.TC_FEISHU_APP_SECRET;

  if (!appId || !appSecret) {
    logger.debug(
      'Feishu channel skipped: TC_FEISHU_APP_ID or TC_FEISHU_APP_SECRET not set',
    );
    return null;
  }

  return new FeishuChannel(appId, appSecret, opts as FeishuChannelOpts);
}

registerChannel('feishu', createFeishuChannel);
