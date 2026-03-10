/**
 * runAgent — lean replacement for the old runAgentOrchestrator.
 *
 * Calls the Claude Agent SDK query() directly. No subprocess, no tmux,
 * no separate executor layer. Claude handles Bash / Read / Edit / Glob
 * natively through its own tool loop.
 *
 * Mind files (SOUL/IDENTITY/USER/MEMORY) are loaded into the system prompt
 * so the agent inherits the OpenClaw-style persona without needing CLAUDE.md.
 */

import { query } from '@anthropic-ai/claude-agent-sdk';
import type { SDKResultMessage } from '@anthropic-ai/claude-agent-sdk';
import { createRequire } from 'module';
import { spawn } from 'node:child_process';
import path from 'path';
import fs from 'fs';
import { loadGroupMindContext } from './core/mind-files.js';
import { logger } from './core/logger.js';
import {
  ASSISTANT_NAME,
  ANTHROPIC_API_KEY,
  OPENROUTER_API_KEY,
  MINIMAX_API_KEY,
  MINIMAX_BASE_URL,
  DEFAULT_LLM_MODEL,
} from './core/config.js';
import type { RegisteredProject } from './core/types.js';

/**
 * Env vars to inject into the claude-code subprocess.
 * When MINIMAX_API_KEY is set, redirect the subprocess's Anthropic calls
 * to MiniMax's Anthropic-compatible endpoint instead.
 */
const LLM_ENV: Record<string, string | undefined> = MINIMAX_API_KEY
  ? {
      ANTHROPIC_API_KEY: MINIMAX_API_KEY,
      ANTHROPIC_BASE_URL: MINIMAX_BASE_URL,
    }
  : OPENROUTER_API_KEY
    ? {
        ANTHROPIC_API_KEY: OPENROUTER_API_KEY,
        ANTHROPIC_BASE_URL: 'https://openrouter.ai/api/v1',
      }
    : ANTHROPIC_API_KEY
      ? { ANTHROPIC_API_KEY }
      : {};

// Explicitly resolve the CLI path to avoid PNPM workspace symlink issues
// where the internal `import.meta.url` resolution inside the SDK throws an ENOENT.
const require = createRequire(import.meta.url);
const sdkIndex = require.resolve('@anthropic-ai/claude-agent-sdk');
const CLI_PATH = path.join(path.dirname(sdkIndex), 'cli.js');

export interface RunAgentOpts {
  chatJid: string;
  group: RegisteredProject;
  workspacePath: string;
  /** Full conversation history (most recent last) */
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  /** Called with each reply text chunk (e.g. to edit a typing indicator msg) */
  onProgress?: (text: string, elapsedMs: number) => Promise<void> | void;
  /** Called once at the end with the final reply */
  onReply: (text: string) => Promise<void> | void;
}

/**
 * Build the system prompt from mind files + base identity.
 */
function buildSystemPrompt(group: RegisteredProject): string {
  const base =
    `You are ${ASSISTANT_NAME} 🦀, a robot mind assistant built with TiClaw.\n` +
    `Work in the provided workspace directory. Be concise and helpful.\n` +
    `You can read, edit, run bash commands, and search the workspace.` +
    `\n\nFor persona or memory changes requested by users, directly update the ` +
    `relevant mind files (SOUL.md, MEMORY.md) in the workspace directory.`;

  const mindContext = loadGroupMindContext(group.folder);
  return mindContext ? `${base}\n\n${mindContext}` : base;
}

export async function runAgent(opts: RunAgentOpts): Promise<void> {
  const { chatJid, group, workspacePath, messages, onProgress, onReply } = opts;
  const start = Date.now();

  // Build the prompt from the conversation history
  const lastUser = messages.filter((m) => m.role === 'user').at(-1);
  if (!lastUser) {
    await onReply('(no message)');
    return;
  }

  // Include recent history above the latest message as context
  const historyLines = messages
    .slice(0, -1)
    .map(
      (m) =>
        `${m.role === 'assistant' ? ASSISTANT_NAME : 'User'}: ${m.content}`,
    )
    .join('\n');
  const prompt = historyLines
    ? `[Recent conversation]\n${historyLines}\n\n[Latest message]\n${lastUser.content}`
    : lastUser.content;

  const systemPrompt = buildSystemPrompt(group);

  logger.info(
    {
      chatJid,
      folder: group.folder,
      promptLen: prompt.length,
      model: DEFAULT_LLM_MODEL ?? 'default',
      cliPath: CLI_PATH,
      cliPathExists: fs.existsSync(CLI_PATH),
    },
    'runAgent: start',
  );

  const textParts: string[] = [];
  let lastProgressAt = 0;
  const PROGRESS_INTERVAL_MS = 100;

  try {
    if (!fs.existsSync(workspacePath)) {
      fs.mkdirSync(workspacePath, { recursive: true });
    }

    for await (const msg of query({
      prompt,
      options: {
        systemPrompt,
        cwd: workspacePath,
        pathToClaudeCodeExecutable: CLI_PATH,
        allowedTools: ['Read', 'Edit', 'Bash', 'Glob', 'Grep', 'Write'],
        permissionMode: 'acceptEdits',
        model: DEFAULT_LLM_MODEL || 'claude-3-5-sonnet-20241022',
        spawnClaudeCodeProcess: (opts) => {
          // The SDK tries to use the CLI_PATH as the command, which fails if not executable
          // We wrap it in the current Node binary explicitly to bypass ENOENT errors on Unix PNPM setups
          const cp = spawn(process.execPath, opts.args, {
            cwd: opts.cwd,
            env: {
              ...process.env,
              ...opts.env,
            },
            signal: opts.signal,
            stdio: 'pipe',
          });
          cp.stderr.on('data', (d) => {
            logger.error({ output: d.toString() }, 'claude stderr');
          });
          return cp as any;
        },
        env: { ...process.env, ...LLM_ENV } as Record<string, string>,
      },
    })) {
      const elapsed = Date.now() - start;
      const msgType = (msg as any).type;

      if (msgType === 'assistant') {
        const blocks = (msg as any).message?.content ?? [];
        for (const block of blocks) {
          if (block.type === 'text' && block.text) {
            textParts.push(block.text);
            if (
              onProgress &&
              elapsed - lastProgressAt >= PROGRESS_INTERVAL_MS
            ) {
              lastProgressAt = elapsed;
              await onProgress(block.text, elapsed);
            }
          }
        }
      }

      if (msgType === 'result') {
        const resultMsg = msg as SDKResultMessage;
        const finalText =
          (resultMsg as any).result?.trim() ||
          textParts.join('\n').trim() ||
          '(done)';
        logger.info(
          { chatJid, elapsed, subtype: (resultMsg as any).subtype },
          'runAgent: done',
        );
        await onReply(finalText);
        return;
      }
    }

    // Stream ended without ResultMessage
    const finalText = textParts.join('\n').trim() || '(done)';
    await onReply(finalText);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ chatJid, err: msg }, 'runAgent: failed');
    await onReply(`Error: ${msg}`);
  }
}
