import fs from 'fs';
import { logger } from '../core/logger.js';
import { RegisteredProject } from '../core/types.js';
import { runPrompt } from './subprocess.js';

export interface ExecutorOptions {
  group: RegisteredProject;
  workspacePath: string;
  codingCli?: string;
}

/**
 * Subprocess-based workspace CLI executor.
 * Runs the coding CLI in headless mode (no tmux, no persistent terminal).
 */
export class Executor {
  private opts: ExecutorOptions;

  constructor(opts: ExecutorOptions) {
    this.opts = opts;
  }

  private ensureWorkspace(): void {
    const { workspacePath } = this.opts;
    if (!fs.existsSync(workspacePath)) {
      fs.mkdirSync(workspacePath, { recursive: true });
    }
  }

  /**
   * Capture: no persistent session. Return a ready message.
   */
  async capture(): Promise<string> {
    this.ensureWorkspace();
    return 'Workspace ready. Send a prompt to run the coding CLI.';
  }

  /**
   * Wait for idle: no persistent session. Always ready.
   */
  async waitForIdle(
    _timeoutMs: number = 600_000,
    _pollMs: number = 3000,
  ): Promise<string> {
    this.ensureWorkspace();
    return 'Ready.';
  }

  /**
   * Run a prompt and call onIdle with the output when done.
   * Replaces the old send+monitor pattern.
   */
  async runPromptAndNotify(
    prompt: string,
    onIdle: (output: string) => void,
    opts?: {
      onProgress?: (output: string, elapsedMs: number) => void;
      progressIntervalMs?: number;
    },
  ): Promise<void> {
    this.ensureWorkspace();

    const start = Date.now();
    const progressIntervalMs = opts?.progressIntervalMs ?? 30_000;
    let lastProgress = 0;

    const progressTimer = setInterval(() => {
      if (opts?.onProgress && Date.now() - lastProgress >= progressIntervalMs) {
        lastProgress = Date.now();
        opts.onProgress('Working on the task...', Date.now() - start);
      }
    }, progressIntervalMs);

    try {
      const result = await runPrompt(
        this.opts.workspacePath,
        this.opts.codingCli || 'gemini',
        prompt,
      );

      clearInterval(progressTimer);

      if (result.exitCode !== 0 && result.exitCode !== 42) {
        const errMsg =
          result.stderr || result.stdout || `Exit code ${result.exitCode}`;
        logger.warn(
          { exitCode: result.exitCode, stderr: result.stderr },
          'Workspace CLI exited with error',
        );
        onIdle(`Error (exit ${result.exitCode}): ${errMsg.slice(0, 500)}`);
        return;
      }

      onIdle(result.stdout || result.stderr || '(no output)');
    } catch (err) {
      clearInterval(progressTimer);
      const msg = err instanceof Error ? err.message : 'Unknown error';
      logger.error({ err: msg }, 'Workspace CLI failed');
      onIdle(`Error: ${msg}`);
    }
  }

  /**
   * @deprecated Use runPromptAndNotify. Kept for API compatibility.
   */
  async send(prompt: string): Promise<void> {
    this.ensureWorkspace();
    await runPrompt(
      this.opts.workspacePath,
      this.opts.codingCli || 'gemini',
      prompt,
    );
  }

  /**
   * @deprecated No-op. No persistent session to monitor.
   */
  monitorForIdle(
    _onIdle: (screen: string) => void,
    _opts?: {
      timeoutMs?: number;
      pollMs?: number;
      onProgress?: (screen: string, elapsedMs: number) => void;
      progressIntervalMs?: number;
    },
  ): void {
    logger.debug('monitorForIdle: no-op (subprocess mode)');
  }

  /**
   * @deprecated No-op. No persistent session to kill.
   */
  async killSession(): Promise<void> {
    /* no-op */
  }
}
