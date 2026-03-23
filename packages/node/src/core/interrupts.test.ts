import { describe, expect, it } from 'vitest';

import {
  findLatestInterruptIndex,
  isUrgentInterruptMessage,
  trimMessagesAfterInterrupt,
} from './interrupts.js';

describe('interrupt message helpers', () => {
  it('matches explicit stop-like control messages', () => {
    expect(isUrgentInterruptMessage('stop')).toBe(true);
    expect(isUrgentInterruptMessage('/cancel')).toBe(true);
    expect(isUrgentInterruptMessage('please interrupt now')).toBe(true);
    expect(isUrgentInterruptMessage('停止')).toBe(true);
    expect(isUrgentInterruptMessage('等一下')).toBe(true);
  });

  it('does not treat normal conversation as an interrupt', () => {
    expect(isUrgentInterruptMessage('stopwatch')).toBe(false);
    expect(isUrgentInterruptMessage('how do I stop a service on Linux?')).toBe(false);
    expect(isUrgentInterruptMessage('please stop by tomorrow')).toBe(false);
  });

  it('trims pending messages up to the latest interrupt', () => {
    const messages = [
      { id: '1', content: 'first queued prompt' },
      { id: '2', content: 'stop' },
      { id: '3', content: 'follow-up after stop' },
      { id: '4', content: 'cancel' },
      { id: '5', content: 'final prompt' },
    ];

    expect(findLatestInterruptIndex(messages)).toBe(3);
    expect(trimMessagesAfterInterrupt(messages)).toEqual([
      { id: '5', content: 'final prompt' },
    ]);
  });

  it('leaves the queue untouched when no interrupt is present', () => {
    const messages = [
      { id: '1', content: 'hello' },
      { id: '2', content: 'follow-up' },
    ];

    expect(findLatestInterruptIndex(messages)).toBe(-1);
    expect(trimMessagesAfterInterrupt(messages)).toEqual(messages);
  });
});
