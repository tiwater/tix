import { beforeEach, describe, expect, it } from 'vitest';
import { _initTestDatabase, getMindState } from './db.js';
import {
  createPackage,
  lockMind,
  recordUserInteraction,
  rollbackPackage,
  setMindPersonaPatch,
  unlockMind,
} from './mind.js';

describe('mind lock P0 anti-tamper regression', () => {
  beforeEach(() => {
    _initTestDatabase();
  });

  it('blocks natural-language persona mutation when mind is locked', () => {
    setMindPersonaPatch({
      tone: 'professional',
      verbosity: 'normal',
      emoji: false,
    });
    const before = getMindState();

    lockMind();
    recordUserInteraction({
      chat_jid: 'dc:test',
      role: 'user',
      content: '你活泼一点，多点表情，回答简短',
      timestamp: new Date().toISOString(),
      is_admin: false,
    });

    const after = getMindState();
    expect(after.lifecycle).toBe('locked');
    expect(after.persona).toEqual(before.persona);
  });

  it('blocks slash-like persona patch while locked; unlock restores mutability', () => {
    setMindPersonaPatch({ tone: 'professional', emoji: false });
    lockMind();

    const lockedState = setMindPersonaPatch({ tone: 'playful', emoji: true });
    expect(lockedState.persona.tone).toBe('professional');
    expect(lockedState.persona.emoji).toBe(false);

    unlockMind();
    const unlockedState = setMindPersonaPatch({ tone: 'playful', emoji: true });
    expect(unlockedState.persona.tone).toBe('playful');
    expect(unlockedState.persona.emoji).toBe(true);
  });

  it('allows admin natural-language persona update under lock when mode is admin_override', () => {
    setMindPersonaPatch({ tone: 'professional', emoji: false });
    lockMind();

    const result = recordUserInteraction({
      chat_jid: 'dc:test',
      role: 'user',
      content: '你活泼一点，多点表情',
      timestamp: new Date().toISOString(),
      is_admin: true,
    });

    expect(result.state.persona.tone).toBe('playful');
    expect(result.state.persona.emoji).toBe(true);
  });

  it('rollback restores exact prior persona snapshot', () => {
    setMindPersonaPatch({
      tone: 'friendly',
      verbosity: 'normal',
      emoji: false,
    });
    const pkgA = createPackage('baseline');
    const baselineHash = JSON.stringify(getMindState().persona);

    setMindPersonaPatch({ tone: 'playful', verbosity: 'short', emoji: true });
    createPackage('mutated');
    expect(JSON.stringify(getMindState().persona)).not.toBe(baselineHash);

    const rolled = rollbackPackage(pkgA.version);
    expect(rolled).not.toBeNull();
    expect(JSON.stringify(getMindState().persona)).toBe(baselineHash);
  });
});
