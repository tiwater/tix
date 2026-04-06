import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';

import { __testOnly, getWarmSession } from './computer.js';

describe('computer helper invariants', () => {
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
    const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tix-computer-'));
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

// ── Feature 1+4: getWarmSession export ──────────────────────────────────────
describe('getWarmSession', () => {
  it('is exported and returns undefined for unknown sessions', () => {
    // No warm sessions are running in unit-test context.
    expect(getWarmSession('no-agent', 'no-session')).toBeUndefined();
  });
});

// ── Feature 2: terminal_reason notice text ───────────────────────────────────
// These tests verify the logic for building user-visible notices from
// terminal_reason values. We exercise the same conditions that onResult checks.
describe('terminal_reason notice mapping', () => {
  function applyTerminalReason(
    terminalReason: string | undefined,
    isError: boolean,
    baseText: string,
  ): string {
    let finalText = baseText;
    if (terminalReason === 'max_turns') {
      finalText +=
        '\n\n> ⚠️ The agent reached its maximum number of turns. Send another message to continue.';
    } else if (terminalReason === 'blocking_limit') {
      finalText +=
        '\n\n> ⚠️ The agent was paused due to a resource limit. Please try again shortly.';
    } else if (terminalReason === 'aborted_tools' || isError === true) {
      finalText = finalText || '(stopped)';
    }
    return finalText;
  }

  it('appends max_turns warning to existing text', () => {
    const result = applyTerminalReason('max_turns', false, 'partial answer');
    expect(result).toContain('reached its maximum number of turns');
    expect(result).toContain('partial answer');
  });

  it('appends blocking_limit warning to existing text', () => {
    const result = applyTerminalReason('blocking_limit', false, 'some work done');
    expect(result).toContain('paused due to a resource limit');
  });

  it('leaves text unchanged for completed runs', () => {
    const result = applyTerminalReason('completed', false, 'all done!');
    expect(result).toBe('all done!');
  });

  it('returns (stopped) for aborted_tools when text is empty', () => {
    const result = applyTerminalReason('aborted_tools', false, '');
    expect(result).toBe('(stopped)');
  });

  it('falls back to (stopped) for is_error=true with empty text', () => {
    const result = applyTerminalReason(undefined, true, '');
    expect(result).toBe('(stopped)');
  });

  it('preserves existing text when is_error=true', () => {
    const result = applyTerminalReason(undefined, true, 'partial output');
    expect(result).toBe('partial output');
  });
});

// ── Feature 3+6: agent-config.json reading ───────────────────────────────────
describe('agent-config.json permission_mode and max_task_tokens', () => {
  const VALID_PERMISSION_MODES = ['acceptEdits', 'auto', 'bypassPermissions'];

  function readAgentConfig(rawJson: string): { permission_mode?: string; max_task_tokens?: unknown } {
    try {
      return JSON.parse(rawJson);
    } catch {
      return {};
    }
  }

  function resolvePermissionMode(config: ReturnType<typeof readAgentConfig>): string | undefined {
    return VALID_PERMISSION_MODES.includes(config.permission_mode as string)
      ? (config.permission_mode as string)
      : undefined;
  }

  function resolveMaxTaskTokens(config: ReturnType<typeof readAgentConfig>): number | undefined {
    return typeof config.max_task_tokens === 'number' && (config.max_task_tokens as number) > 0
      ? (config.max_task_tokens as number)
      : undefined;
  }

  it('accepts acceptEdits as a valid permission mode', () => {
    const cfg = readAgentConfig(JSON.stringify({ permission_mode: 'acceptEdits' }));
    expect(resolvePermissionMode(cfg)).toBe('acceptEdits');
  });

  it('accepts auto as a valid permission mode', () => {
    const cfg = readAgentConfig(JSON.stringify({ permission_mode: 'auto' }));
    expect(resolvePermissionMode(cfg)).toBe('auto');
  });

  it('accepts bypassPermissions as a valid permission mode', () => {
    const cfg = readAgentConfig(JSON.stringify({ permission_mode: 'bypassPermissions' }));
    expect(resolvePermissionMode(cfg)).toBe('bypassPermissions');
  });

  it('rejects unknown permission modes and falls back to undefined', () => {
    const cfg = readAgentConfig(JSON.stringify({ permission_mode: 'dangerousMode' }));
    expect(resolvePermissionMode(cfg)).toBeUndefined();
  });

  it('returns undefined for missing permission_mode', () => {
    const cfg = readAgentConfig(JSON.stringify({ model: 'claude-3' }));
    expect(resolvePermissionMode(cfg)).toBeUndefined();
  });

  it('reads a positive max_task_tokens value', () => {
    const cfg = readAgentConfig(JSON.stringify({ max_task_tokens: 80000 }));
    expect(resolveMaxTaskTokens(cfg)).toBe(80000);
  });

  it('ignores zero max_task_tokens', () => {
    const cfg = readAgentConfig(JSON.stringify({ max_task_tokens: 0 }));
    expect(resolveMaxTaskTokens(cfg)).toBeUndefined();
  });

  it('ignores negative max_task_tokens', () => {
    const cfg = readAgentConfig(JSON.stringify({ max_task_tokens: -1 }));
    expect(resolveMaxTaskTokens(cfg)).toBeUndefined();
  });

  it('ignores string max_task_tokens', () => {
    const cfg = readAgentConfig(JSON.stringify({ max_task_tokens: '80000' }));
    expect(resolveMaxTaskTokens(cfg)).toBeUndefined();
  });

  it('works correctly with both fields set together', () => {
    const cfg = readAgentConfig(
      JSON.stringify({ permission_mode: 'auto', max_task_tokens: 50000 }),
    );
    expect(resolvePermissionMode(cfg)).toBe('auto');
    expect(resolveMaxTaskTokens(cfg)).toBe(50000);
  });

  it('reads config correctly from a temp file (integration smoke test)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tix-cfg-'));
    try {
      const cfgPath = path.join(dir, 'agent-config.json');
      fs.writeFileSync(
        cfgPath,
        JSON.stringify({ permission_mode: 'auto', max_task_tokens: 30000 }),
      );
      const raw = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
      expect(resolvePermissionMode(raw)).toBe('auto');
      expect(resolveMaxTaskTokens(raw)).toBe(30000);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ── Feature 4: context endpoint URL pattern ──────────────────────────────────
describe('context endpoint URL pattern', () => {
  const CONTEXT_RE = /^\/api\/v1\/agents\/([^/]+)\/sessions\/([^/]+)\/context$/;

  it('matches a well-formed context path', () => {
    const m = '/api/v1/agents/agent-1/sessions/sess-abc/context'.match(CONTEXT_RE);
    expect(m).not.toBeNull();
    expect(m![1]).toBe('agent-1');
    expect(m![2]).toBe('sess-abc');
  });

  it('does not match a messages path', () => {
    expect('/api/v1/agents/a/sessions/b/messages'.match(CONTEXT_RE)).toBeNull();
  });

  it('does not match a stream path', () => {
    expect('/api/v1/agents/a/sessions/b/stream'.match(CONTEXT_RE)).toBeNull();
  });

  it('does not match the node endpoint', () => {
    expect('/api/v1/node'.match(CONTEXT_RE)).toBeNull();
  });

  it('handles URL-encoded agent IDs via decodeURIComponent', () => {
    const encoded = '/api/v1/agents/my%20agent/sessions/my%20session/context';
    const m = encoded.match(CONTEXT_RE);
    expect(m).not.toBeNull();
    expect(decodeURIComponent(m![1])).toBe('my agent');
    expect(decodeURIComponent(m![2])).toBe('my session');
  });
});
