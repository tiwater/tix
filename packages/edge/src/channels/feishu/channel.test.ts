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
    channel = new FeishuChannel({
      app_id: 'test-app-id',
      app_secret: 'test-app-secret',
      verification_token: 'test-verification-token',
      encrypt_key: 'test-encrypt-key',
    } as any);
  });

  describe('dispatcher', () => {
    it('should have handles map with expected keys', () => {
      // The channel has a dispatcher with handles
      expect(channel.dispatcher).toBeDefined();
      expect(channel.dispatcher.handles).toBeInstanceOf(Map);
    });

    it('should have ping handler registered', () => {
      // Check if ping handler exists using the correct API
      const pingHandler = channel.dispatcher.handles.get('ping');
      expect(pingHandler).toBeDefined();
      expect(typeof pingHandler).toBe('function');
    });
  });

  describe('isConnected', () => {
    it('should return true when client is set', () => {
      // After initialization, client should be set
      expect(channel.isConnected()).toBe(true);
    });
  });
});