import { describe, expect, it } from 'vitest';

import { formatProgressText, progressKeyFromEvent } from './progress.js';

describe('progress helpers', () => {
  it('suppresses speaking deltas for progress text', () => {
    expect(
      formatProgressText({
        phase: 'stream_event',
        action: 'speaking',
        target: 'hello',
        elapsed_ms: 1200,
      }),
    ).toBeNull();
  });

  it('formats tool execution with a useful target summary', () => {
    const text = formatProgressText({
      phase: 'assistant',
      action: 'executing_Bash',
      target: JSON.stringify({
        command: 'pnpm test src/core/progress.test.ts',
      }),
      elapsed_ms: 4500,
    });
    expect(text).toContain('正在调用 Bash');
    expect(text).toContain('pnpm test src/core/progress.test.ts');
    expect(text).toContain('5s');
  });

  it('falls back to generic progress text when no tool/action is known', () => {
    const text = formatProgressText({
      phase: 'idle',
      elapsed_ms: 1,
    });
    expect(text).toContain('正在处理中');
    expect(text).toContain('1s');
  });

  it('builds a stable progress key from phase/action', () => {
    expect(
      progressKeyFromEvent({ phase: 'assistant', action: 'thinking' }),
    ).toBe('assistant|thinking');
    expect(progressKeyFromEvent({ phase: 'assistant' })).toBe('assistant|');
    expect(progressKeyFromEvent({ action: 'thinking' })).toBe('|thinking');
  });
});
