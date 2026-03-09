import { beforeEach, describe, expect, it, vi } from 'vitest';
import { _initTestDatabase, getMindState } from './db.js';
import {
  createPackage,
  diffMindVersions,
  listPackages,
  lockMind,
  recordUserInteraction,
  rollbackPackage,
  setMindPersonaPatch,
  unlockMind,
} from './mind.js';
import { generateObject } from 'ai';

vi.mock('ai', () => ({
  generateObject: vi.fn(),
}));

describe('mind core', () => {
  beforeEach(() => {
    _initTestDatabase();
    vi.mocked(generateObject).mockReset();
  });

  it('updates persona on natural persona instruction', async () => {
    vi.mocked(generateObject).mockResolvedValueOnce({
      object: {
        intent: 'persona',
        confidence: 0.85,
        persona_patch: { tone: 'playful', verbosity: 'short' },
        reason: 'test',
      },
    } as any);

    const result = await recordUserInteraction({
      chat_jid: 'dc:test',
      role: 'user',
      content: '你活泼一点，回答简短',
      timestamp: new Date().toISOString(),
    });

    expect(result.intent).toBe('persona');
    const state = getMindState();
    expect(state.persona.tone).toBe('playful');
    expect(state.persona.verbosity).toBe('short');
  });

  it('rejects update on low confidence', async () => {
    setMindPersonaPatch({ tone: 'neutral', verbosity: 'normal' });
    vi.mocked(generateObject).mockResolvedValueOnce({
      object: {
        intent: 'persona',
        confidence: 0.4,
        persona_patch: { tone: 'playful' },
        reason: 'test',
      },
    } as any);

    const result = await recordUserInteraction({
      chat_jid: 'dc:test',
      role: 'user',
      content: '你活泼一点',
      timestamp: new Date().toISOString(),
    });

    expect(result.intent).toBe('persona');
    const state = getMindState();
    expect(state.persona.tone).toBe('neutral'); // Should not have updated
  });

  it('does not update persona when locked', async () => {
    lockMind();
    vi.mocked(generateObject).mockResolvedValue({
      object: {
        intent: 'persona',
        confidence: 0.9,
        persona_patch: { tone: 'playful' },
        reason: 'test reasoning',
      },
    } as any);

    await recordUserInteraction({
      chat_jid: 'dc:test',
      role: 'user',
      content: '你活泼一点',
      timestamp: new Date().toISOString(),
    });

    const state = getMindState();
    expect(state.lifecycle).toBe('locked');
    expect(state.persona.tone).not.toBe('playful');

    unlockMind();
    await recordUserInteraction({
      chat_jid: 'dc:test',
      role: 'user',
      content: '你活泼一点',
      timestamp: new Date().toISOString(),
    });
    expect(getMindState().persona.tone).toBe('playful');
  });

  it('creates and rollbacks packages', () => {
    const p1 = createPackage('first');
    const p2 = createPackage('second');
    expect(p2.version).toBeGreaterThan(p1.version);
    expect(listPackages(10).length).toBeGreaterThanOrEqual(2);

    const rolled = rollbackPackage(p1.version);
    expect(rolled?.version).toBe(p1.version);
  });

  it('supports slash-like persona patch and version diff', () => {
    setMindPersonaPatch({ tone: 'playful', emoji: true });
    const p1 = createPackage('playful');

    setMindPersonaPatch({ tone: 'professional', emoji: false });
    const p2 = createPackage('professional');

    const diff = diffMindVersions(p1.version, p2.version);
    expect(diff).toContain('tone');
  });
});
