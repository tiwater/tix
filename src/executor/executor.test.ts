import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, describe, expect, it } from 'vitest';
import type { RegisteredProject } from '../core/types.js';
import { Executor } from './executor.js';

describe('Executor (subprocess mode)', () => {
  const testDir = path.join(os.tmpdir(), `executor-test-${Date.now()}`);
  const group: RegisteredProject = {
    name: 'test-group',
    folder: `executor-test-${Date.now()}`,
    trigger: '* * * * *',
    added_at: new Date().toISOString(),
  };

  afterAll(() => {
    try {
      fs.rmSync(testDir, { recursive: true, force: true });
    } catch {}
  });

  it('capture() returns ready message', async () => {
    const executor = new Executor({
      group,
      workspacePath: testDir,
      codingCli: 'gemini',
    });
    const screen = await executor.capture();
    expect(screen).toContain('Workspace ready');
  });

  it('waitForIdle() returns Ready', async () => {
    const executor = new Executor({
      group,
      workspacePath: testDir,
      codingCli: 'gemini',
    });
    const result = await executor.waitForIdle();
    expect(result).toBe('Ready.');
  });

  it('runPromptAndNotify calls onIdle with output', async () => {
    fs.mkdirSync(testDir, { recursive: true });
    // Use a test script that mimics gemini headless (-p for prompt)
    const scriptPath = path.join(testDir, 'mock-cli.js');
    fs.writeFileSync(
      scriptPath,
      `const i=process.argv.indexOf('-p'); console.log('Output:', process.argv[i+1]||'');`,
    );
    const executor = new Executor({
      group,
      workspacePath: testDir,
      codingCli: `node ${scriptPath}`,
    });
    const output = await new Promise<string>((resolve) => {
      executor.runPromptAndNotify('hello world', resolve);
    });
    expect(output).toContain('Output:');
    expect(output).toContain('hello world');
  });
});
