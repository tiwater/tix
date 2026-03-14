import { describe, it, expect, vi } from 'vitest';
import { AbstractChannel } from './base.js';
import { ChannelOpts } from '../core/types.js';

// Mock concrete implementation
class MockChannel extends AbstractChannel<any, any> {
  name = 'mock';
  protected initInstances(accounts: any[]): void {}
  protected async connectInstance(): Promise<void> {}
  protected async disconnectInstance(): Promise<void> {}
  async sendMessage(): Promise<void> {}
  async sendFile(): Promise<void> {}
}

describe('AbstractChannel', () => {
  const opts: ChannelOpts = {
    onMessage: () => {},
    onChatMetadata: () => {},
    registeredProjects: () => ({}),
  };

  it('should correctly parse standard Ticlaw JIDs', () => {
    const channel = new MockChannel(opts);
    const parsed = (channel as any).parseJid('feishu:app_123:chat_456');
    expect(parsed.channel).toBe('feishu');
    expect(parsed.appId).toBe('app_123');
    expect(parsed.chatId).toBe('chat_456');
  });

  it('should handle legacy or short JIDs gracefully', () => {
    const channel = new MockChannel(opts);
    const parsed = (channel as any).parseJid('web:session_789');
    expect(parsed.channel).toBe('web');
    expect(parsed.appId).toBe('session_789');
    expect(parsed.chatId).toBe('');
  });

  it('should identify owned JIDs based on name', () => {
    const channel = new MockChannel(opts);
    expect(channel.ownsJid('mock:anything')).toBe(true);
    expect(channel.ownsJid('other:anything')).toBe(false);
  });
});
