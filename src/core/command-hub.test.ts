import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CommandHub } from './command-hub.js';

describe('CommandHub', () => {
  beforeEach(() => {
    CommandHub.init();
  });

  it('should ignore normal conversational text', async () => {
    const response = await CommandHub.tryExecute('hello assistant');
    expect(response).toBeNull();
  });

  it('should intercept and execute /help command', async () => {
    const response = await CommandHub.tryExecute('/help');
    expect(response).not.toBeNull();
    expect(response?.type).toBe('text');
    expect(response?.content).toContain('快捷指令');
  });

  it('should return system status card for /status command', async () => {
    const response = await CommandHub.tryExecute('/status');
    expect(response).not.toBeNull();
    expect(response?.type).toBe('card');
    expect(response?.data.title).toContain('运行状态');
  });

  it('should handle unknown commands gracefully', async () => {
    const response = await CommandHub.tryExecute('/unknown_command_xyz');
    expect(response?.content).toContain('未知指令');
  });
});
