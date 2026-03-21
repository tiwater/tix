/**
 * Store resolveFromChatJid tests (Issue #62)
 */
import { describe, it, expect } from 'vitest';
import { resolveFromChatJid } from './store.js';

describe('store resolveFromChatJid Issue #62', () => {
  it('should resolve web JID', () => {
    const res = resolveFromChatJid('web:agent1:sess1');
    expect(res).toEqual({ agentId: 'agent1', sessionId: 'sess1' });
  });

  it('should resolve acp JID', () => {
    const res = resolveFromChatJid('acp:agent1:sess1');
    expect(res).toEqual({ agentId: 'agent1', sessionId: 'sess1' });
  });

  it('should resolve feishu JID (Issue #62)', () => {
    const res = resolveFromChatJid('feishu:app1:chat1');
    expect(res).toEqual({ agentId: 'app1', sessionId: 'chat1' });
  });

  it('should resolve fs JID (Issue #62)', () => {
    const res = resolveFromChatJid('fs:app1:chat1');
    expect(res).toEqual({ agentId: 'app1', sessionId: 'chat1' });
  });

  it('should return null for unknown JID', () => {
    const res = resolveFromChatJid('unknown:a:b');
    expect(res).toBeNull();
  });
});
