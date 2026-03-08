import fs from 'fs';
import os from 'os';
import path from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RegisteredProject } from '../core/types.js';

vi.mock('./subprocess.js', () => ({
  runPrompt: vi.fn().mockResolvedValue({
    stdout: 'mock output',
    stderr: '',
    exitCode: 0,
  }),
}));

import { Executor } from './executor.js';
import { runPrompt } from './subprocess.js';

describe('Executor', () => {
  const workspaceDir = path.join(os.tmpdir(), `executor-unit-${process.pid}`);
  const group: RegisteredProject = {
    name: 'unit-group',
    folder: 'unit-folder',
    trigger: '* * * * *',
    added_at: new Date().toISOString(),
  };

  beforeEach(() => {
    fs.mkdirSync(workspaceDir, { recursive: true });
    vi.mocked(runPrompt).mockResolvedValue({
      stdout: 'mock output',
      stderr: '',
      exitCode: 0,
    });
  });

  it('capture() returns ready message', async () => {
    const executor = new Executor({ group, workspacePath: workspaceDir });
    const screen = await executor.capture();
    expect(screen).toContain('Workspace ready');
  });

  it('waitForIdle() returns Ready', async () => {
    const executor = new Executor({ group, workspacePath: workspaceDir });
    const result = await executor.waitForIdle();
    expect(result).toBe('Ready.');
  });

  it('runPromptAndNotify calls onIdle with runPrompt output', async () => {
    const executor = new Executor({ group, workspacePath: workspaceDir });
    const output = await new Promise<string>((resolve) => {
      executor.runPromptAndNotify('test prompt', resolve);
    });
    expect(runPrompt).toHaveBeenCalledWith(
      workspaceDir,
      'gemini',
      'test prompt',
    );
    expect(output).toBe('mock output');
  });
});
