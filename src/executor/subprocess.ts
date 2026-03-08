import { spawn } from 'child_process';
import { logger } from '../core/logger.js';
import { readEnvFile } from '../core/env.js';

/**
 * Subprocess-based workspace CLI runner.
 * Uses headless mode (e.g. `gemini -p "prompt" -y`) — no tmux, no persistent terminal.
 */

function shellEscapeSingleQuoted(value: string): string {
  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}

function buildEnv(): Record<string, string> {
  const passthrough = [
    'http_proxy',
    'https_proxy',
    'HTTP_PROXY',
    'HTTPS_PROXY',
    'ALL_PROXY',
    'NO_PROXY',
    'no_proxy',
    'GOOGLE_API_KEY',
    'GEMINI_API_KEY',
    'GITHUB_TOKEN',
    'GITHUB_MCP_PAT',
  ];

  const env: Record<string, string> = { ...process.env };
  const yamlEnv = readEnvFile(passthrough);

  for (const key of passthrough) {
    const val = process.env[key] || yamlEnv[key];
    if (val) env[key] = val;
  }

  return env;
}

/**
 * Resolve CLI command for headless mode.
 * e.g. "gemini" -> ["gemini", "-p", prompt, "-y"]
 * "gemini -y" -> ["gemini", "-p", prompt, "-y"]
 */
function resolveHeadlessArgs(
  codingCli: string,
  prompt: string,
): { cmd: string; args: string[] } {
  const parts = (codingCli || 'gemini').trim().split(/\s+/);
  const cmd = parts[0];
  const existing = parts.slice(1);

  const hasYolo =
    existing.includes('-y') ||
    existing.includes('--yolo') ||
    existing.some((p) => p.startsWith('--yolo='));

  const args = [...existing.filter((p) => p !== '-p' && p !== '--prompt')];
  args.push('-p', prompt);
  if (!hasYolo) args.push('-y');

  return { cmd, args };
}

export interface RunPromptResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * Run the coding CLI in headless mode with the given prompt.
 * Returns when the process completes.
 */
export async function runPrompt(
  cwd: string,
  codingCli: string,
  prompt: string,
  timeoutMs: number = 600_000,
): Promise<RunPromptResult> {
  const { cmd, args } = resolveHeadlessArgs(codingCli, prompt);
  const env = buildEnv();

  logger.info({ cmd, cwd, promptLen: prompt.length }, 'Running workspace CLI (headless)');

  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    proc.stdout?.on('data', (data: Buffer) => {
      stdout += data.toString();
    });
    proc.stderr?.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    const timeout = setTimeout(() => {
      proc.kill('SIGTERM');
      reject(new Error(`Workspace CLI timed out after ${timeoutMs / 1000}s`));
    }, timeoutMs);

    proc.on('close', (code, signal) => {
      clearTimeout(timeout);
      resolve({
        stdout,
        stderr,
        exitCode: code ?? (signal ? 1 : 0),
      });
    });

    proc.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}
