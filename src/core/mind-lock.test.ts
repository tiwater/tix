import { beforeEach, describe, expect, it } from 'vitest';
import { _initTestDatabase, getMindState } from './db.js';
import {
  createPackage,
  lockMind,
  rollbackPackage,
  setMindPersonaPatch,
  unlockMind,
} from './mind.js';

// No LLM mock needed — intent parsing removed

describe('mind lock P0 anti-tamper regression', () => {
  beforeEach(() => {
    _initTestDatabase();
  });

  it('blocks slash-like persona patch while locked', () => {
    setMindPersonaPatch({ tone: 'professional', verbosity: 'normal', emoji: false });
    const before = getMindState();

    lockMind();
    const after = setMindPersonaPatch({ tone: 'playful', verbosity: 'short', emoji: true });

    expect(after.lifecycle).toBe('locked');
    expect(after.persona).toEqual(before.persona);
  });

  it('unlocking restores mutability', () => {
    setMindPersonaPatch({ tone: 'professional', emoji: false });
    lockMind();

    const lockedState = setMindPersonaPatch({ tone: 'playful', emoji: true });
    expect(lockedState.persona.tone).toBe('professional');

    unlockMind();
    const unlockedState = setMindPersonaPatch({ tone: 'playful', emoji: true });
    expect(unlockedState.persona.tone).toBe('playful');
    expect(unlockedState.persona.emoji).toBe(true);
  });

  it('rollback restores exact prior persona snapshot', () => {
    setMindPersonaPatch({ tone: 'friendly', verbosity: 'normal', emoji: false });
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
