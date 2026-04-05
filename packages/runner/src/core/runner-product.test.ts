/**
 * Tests for TICLAW_PRODUCT_NAME branding support.
 * Verifies that user-visible strings are driven by the TICLAW_PRODUCT_NAME env var
 * so @supen/runner and @ticos/runner can brand correctly without code changes.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('TICLAW_PRODUCT_NAME branding', () => {
  const originalProduct = process.env.TICLAW_PRODUCT_NAME;

  afterEach(() => {
    // Restore env after each test
    if (originalProduct === undefined) {
      delete process.env.TICLAW_PRODUCT_NAME;
    } else {
      process.env.TICLAW_PRODUCT_NAME = originalProduct;
    }
    vi.resetModules();
  });

  describe('system.ts whoami tool', () => {
    it('defaults to Supen when TICLAW_PRODUCT_NAME is unset', async () => {
      delete process.env.TICLAW_PRODUCT_NAME;
      vi.resetModules();
      const { systemTools } = await import('../tools/system.js');
      const result = await systemTools.whoami({}, { agent_id: 'test-agent' });
      expect(result.description).toContain('Supen Runner');
      expect(result.description).not.toContain('TiClaw');
    });

    it('uses TICLAW_PRODUCT_NAME=supen for Supen branding', async () => {
      process.env.TICLAW_PRODUCT_NAME = 'supen';
      vi.resetModules();
      const { systemTools } = await import('../tools/system.js');
      const result = await systemTools.whoami({}, { agent_id: 'my-agent' });
      expect(result.description).toContain('Supen Runner');
      expect(result.agent_id).toBe('my-agent');
    });

    it('uses TICLAW_PRODUCT_NAME=ticos for Ticos branding', async () => {
      process.env.TICLAW_PRODUCT_NAME = 'ticos';
      vi.resetModules();
      const { systemTools } = await import('../tools/system.js');
      const result = await systemTools.whoami({}, { agent_id: 'robot-agent' });
      expect(result.description).toContain('Ticos Runner');
    });

    it('capitalises the product name', async () => {
      process.env.TICLAW_PRODUCT_NAME = 'acme';
      vi.resetModules();
      const { systemTools } = await import('../tools/system.js');
      const result = await systemTools.whoami({}, { agent_id: 'x' });
      expect(result.description).toContain('Acme Runner');
    });
  });

  describe('status-inspector.ts card title', () => {
    it('defaults to Supen when TICLAW_PRODUCT_NAME is unset', async () => {
      delete process.env.TICLAW_PRODUCT_NAME;
      vi.resetModules();
      const { StatusInspector } = await import('../core/status-inspector.js');
      const card = StatusInspector.generateManagementCard([]);
      expect(card.title).toContain('Supen');
      expect(card.title).not.toContain('TiClaw');
    });

    it('uses TICLAW_PRODUCT_NAME=ticos for Ticos branding', async () => {
      process.env.TICLAW_PRODUCT_NAME = 'ticos';
      vi.resetModules();
      const { StatusInspector } = await import('../core/status-inspector.js');
      const card = StatusInspector.generateManagementCard([]);
      expect(card.title).toContain('Ticos');
    });
  });
});
