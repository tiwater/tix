/**
 * Base Abstract Channel for Tix.
 * Handles Multi-account management and JID-based routing.
 */

import { logger } from '../core/logger.js';
import {
  Channel,
  ChannelOpts,
  OnInboundMessage,
  OnChatMetadata,
  RegisteredProject,
} from '../core/types.js';

export abstract class AbstractChannel<
  TInstance,
  TAccountConfig,
> implements Channel {
  abstract name: string;
  protected instances = new Map<string, TInstance>();
  protected opts: ChannelOpts;

  constructor(opts: ChannelOpts) {
    this.opts = opts;
  }

  /** Initialize instances from a list of account configurations. */
  protected abstract initInstances(accounts: TAccountConfig[]): void;

  /** Physical connection logic for all instances. */
  async connect(): Promise<void> {
    logger.info({ channel: this.name }, `Connecting ${this.name} channel...`);
    const results = await Promise.allSettled(
      Array.from(this.instances.values()).map((inst) =>
        this.connectInstance(inst),
      ),
    );
    // Log failures
    results.forEach((res, i) => {
      if (res.status === 'rejected') {
        logger.error(
          { channel: this.name, index: i, err: res.reason },
          'Instance connection failed',
        );
      }
    });
  }

  protected abstract connectInstance(instance: TInstance): Promise<void>;
  protected abstract disconnectInstance(instance: TInstance): Promise<void>;

  /** Common JID Parser: {channel}:{app_id}:{chat_id} */
  protected parseJid(jid: string): {
    channel: string;
    appId: string;
    chatId: string;
  } {
    const parts = jid.split(':');
    return {
      channel: parts[0],
      appId: parts[1] || 'default',
      chatId: parts[2] || '',
    };
  }

  /** Implementation of Tix Channel Interface */
  async disconnect(): Promise<void> {
    for (const [id, inst] of this.instances) {
      await this.disconnectInstance(inst);
      logger.info({ channel: this.name, appId: id }, 'Instance disconnected');
    }
    this.instances.clear();
  }

  isConnected(): boolean {
    return this.instances.size > 0;
  }

  ownsJid(jid: string): boolean {
    return jid.startsWith(`${this.name}:`);
  }

  /** Delegate to concrete implementations */
  abstract sendMessage(jid: string, text: string, options?: any): Promise<void>;
  abstract sendFile(
    jid: string,
    filePath: string,
    caption?: string,
  ): Promise<void>;

  /** New: Return real-time status of all managed app instances. */
  getInstancesStatus(): Array<{
    appId: string;
    connected: boolean;
    lastActivity: string;
    accountLabel?: string;
  }> {
    // Basic implementation, subclasses can override for more detail.
    return Array.from(this.instances.keys()).map((id) => ({
      appId: id,
      connected: this.isConnected(), // simplified
      lastActivity: new Date().toISOString(),
    }));
  }
}
