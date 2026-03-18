/**
 * Feishu channel tests
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FeishuChannel } from './channel.js';

// Mock dependencies
vi.mock('./helpers.js', () => ({
  createFeishuClient: vi.fn(() => ({})),
  getBotTenantAccessToken: vi.fn(() => Promise.resolve('mock-token')),
}));

describe('FeishuChannel', () => {
  let channel: FeishuChannel;

  beforeEach(() => {
    channel = new FeishuChannel([{
      appId: 'test-app-id',
      appSecret: 'test-app-secret',
      agentId: 'test-agent-id',
    }], {} as any);
  });



  describe('isConnected', () => {
    it('should return true when client is set', () => {
      // After initialization, client should be set
      expect(channel.isConnected()).toBe(true);
    });
  });
});