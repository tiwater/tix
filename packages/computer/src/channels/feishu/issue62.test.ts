/**
 * Feishu channel prefix tests (Issue #62)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FeishuChannel } from './channel.js';

describe('FeishuChannel Issue #62', () => {
  let channel: FeishuChannel;

  beforeEach(() => {
    channel = new FeishuChannel([{
      appId: 'test-app-id',
      appSecret: 'test-app-secret',
      agentId: 'test-agent-id',
    }], {} as any);
  });

  describe('ownsJid', () => {
    it('should own JID with feishu: prefix', () => {
      expect(channel.ownsJid('feishu:app1:chat1')).toBe(true);
    });

    it('should own JID with fs: prefix (Issue #62)', () => {
      expect(channel.ownsJid('fs:app1:chat1')).toBe(true);
    });

    it('should not own JID with other prefix', () => {
      expect(channel.ownsJid('web:app1:chat1')).toBe(false);
      expect(channel.ownsJid('dc:app1:chat1')).toBe(false);
    });
  });
});
