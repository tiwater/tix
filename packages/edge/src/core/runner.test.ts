import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';

import { __testOnly } from './runner.js';

describe('runner helper invariants', () => {
  it('uses agent+session in warm-session key', () => {
    const keyA = __testOnly.buildSessionKey('agent-x', 'session-a');
    const keyB = __testOnly.buildSessionKey('agent-x', 'session-b');

    expect(keyA).toBe('agent-x:session-a');
    expect(keyB).toBe('agent-x:session-b');
    expect(keyA).not.toBe(keyB);
  });

  it('persists claude resume IDs in session-specific files', () => {
    const pathA = __testOnly.getClaudeSessionPath('agent-x', 'session-a');
    const pathB = __testOnly.getClaudeSessionPath('agent-x', 'session-b');

    expect(pathA).not.toBe(pathB);
    expect(path.basename(path.dirname(pathA))).toBe('.claude_sessions');
    expect(path.basename(path.dirname(pathB))).toBe('.claude_sessions');
  });

  it('invalidates prompt key when appending to an existing journal file', async () => {
    const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ticlaw-runner-'));
    try {
      const memoryDir = path.join(baseDir, 'memory');
      fs.mkdirSync(memoryDir, { recursive: true });
      const journalPath = path.join(memoryDir, '2026-03-17.md');
      fs.writeFileSync(journalPath, '- initial entry\n', 'utf-8');

      const before = __testOnly.getPromptMtimeKey(baseDir);
      await new Promise((resolve) => setTimeout(resolve, 15));
      fs.appendFileSync(journalPath, '- appended entry\n', 'utf-8');
      const after = __testOnly.getPromptMtimeKey(baseDir);

      expect(after).not.toBe(before);
    } finally {
      fs.rmSync(baseDir, { recursive: true, force: true });
    }
  });
});
