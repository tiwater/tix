/**
 * runAgent — lean replacement for the old runAgentOrchestrator.
 *
 * Calls the Claude Agent SDK query() directly. No subprocess, no tmux,
 * no separate executor layer. Claude handles Bash / Read / Edit / Glob
 * natively through its own tool loop.
 *
 * Mind files are loaded from the isolated session workspace first, then fall
 * back to the shared agent bootstrap files.
 */

import fs from 'fs';
import path from 'path';

import { query } from '@anthropic-ai/claude-agent-sdk';
import type { SDKResultMessage } from '@anthropic-ai/claude-agent-sdk';
import { loadGroupMindContext } from './core/mind-files.js';
import { logger } from './core/logger.js';
import {
  AGENTS_DIR,
  AGENT_MIND_FILES,
  ASSISTANT_NAME,
  ANTHROPIC_API_KEY,
  DEFAULT_LLM_MODEL,
  MINIMAX_API_KEY,
  MINIMAX_BASE_URL,
} from './core/config.js';
import type { RegisteredProject, SessionContext } from './core/types.js';

const LLM_ENV: Record<string, string | undefined> = MINIMAX_API_KEY
  ? {
      ANTHROPIC_API_KEY: MINIMAX_API_KEY,
      ANTHROPIC_BASE_URL: MINIMAX_BASE_URL,
    }
  : ANTHROPIC_API_KEY
    ? { ANTHROPIC_API_KEY }
    : {};

export interface RunAgentOpts {
  group: RegisteredProject;
  session: SessionContext;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  onProgress?: (text: string, elapsedMs: number) => Promise<void> | void;
  onReply: (text: string) => Promise<void> | void;
}

function safeLogFileSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64) || 'job';
}

function appendJobLog(
  session: SessionContext,
  event: Record<string, unknown>,
): void {
  fs.mkdirSync(session.logs_path, { recursive: true });
  const logPath = path.join(
    session.logs_path,
    `${safeLogFileSegment(session.job_id)}.jsonl`,
  );
  fs.appendFileSync(
    logPath,
    `${JSON.stringify({
      ts: new Date().toISOString(),
      runtime_id: session.runtime_id,
      agent_id: session.agent_id,
      session_id: session.session_id,
      job_id: session.job_id,
      ...event,
    })}\n`,
    'utf-8',
  );
}

function bootstrapAgentMindFiles(
  group: RegisteredProject,
  session: SessionContext,
): void {
  fs.mkdirSync(session.workspace_path, { recursive: true });
  fs.mkdirSync(session.logs_path, { recursive: true });

  const sourceDirs = [path.join(AGENTS_DIR, group.folder), AGENTS_DIR];

  for (const filename of AGENT_MIND_FILES) {
    const dest = path.join(session.workspace_path, filename);
    if (fs.existsSync(dest)) continue;

    const source = sourceDirs
      .map((dir) => path.join(dir, filename))
      .find((candidate) => fs.existsSync(candidate));

    if (source) {
      fs.copyFileSync(source, dest);
    }
  }

  if (!fs.existsSync(session.memory_path)) {
    fs.writeFileSync(
      session.memory_path,
      '# MEMORY\n\nSession-local working memory.\n',
      'utf-8',
    );
  }
}

function loadSessionMindContext(
  group: RegisteredProject,
  session: SessionContext,
): string {
  const parts: string[] = [];
  for (const filename of AGENT_MIND_FILES) {
    const filePath = path.join(session.workspace_path, filename);
    if (!fs.existsSync(filePath)) continue;
    const content = fs.readFileSync(filePath, 'utf-8').trim();
    if (content) parts.push(content);
  }

  if (parts.length === 0) {
    return loadGroupMindContext(group.folder);
  }

  return `\n## Session mind context\n\n${parts.join('\n\n---\n\n')}\n`;
}

function buildSystemPrompt(
  group: RegisteredProject,
  session: SessionContext,
): string {
  const base =
    `You are ${ASSISTANT_NAME} 🦀, a robot mind assistant built with TiClaw.\n` +
    `Work only inside the provided session workspace directory.\n` +
    `Be concise and helpful.\n` +
    `You can read, edit, run bash commands, and search the workspace.` +
    `\n\nFor persona or memory changes requested by users, directly update the ` +
    `relevant mind files (SOUL.md, MEMORY.md) in the workspace directory.`;

  const mindContext = loadSessionMindContext(group, session);
  return mindContext ? `${base}\n\n${mindContext}` : base;
}

export async function runAgent(opts: RunAgentOpts): Promise<void> {
  const { group, session, messages, onProgress, onReply } = opts;
  const log = logger.child({
    runtime_id: session.runtime_id,
    agent_id: session.agent_id,
    session_id: session.session_id,
    job_id: session.job_id,
    chat_jid: session.chat_jid,
  });
  const start = Date.now();

  const lastUser = messages.filter((message) => message.role === 'user').at(-1);
  if (!lastUser) {
    appendJobLog(session, { phase: 'done', result: '(no message)' });
    await onReply('(no message)');
    return;
  }

  bootstrapAgentMindFiles(group, session);

  const historyLines = messages
    .slice(0, -1)
    .map(
      (message) =>
        `${message.role === 'assistant' ? ASSISTANT_NAME : 'User'}: ${message.content}`,
    )
    .join('\n');
  const prompt = historyLines
    ? `[Recent conversation]\n${historyLines}\n\n[Latest message]\n${lastUser.content}`
    : lastUser.content;

  const systemPrompt = buildSystemPrompt(group, session);

  log.info(
    {
      promptLen: prompt.length,
      workspace_path: session.workspace_path,
      model: DEFAULT_LLM_MODEL ?? 'default',
    },
    'runAgent: start',
  );
  appendJobLog(session, {
    phase: 'start',
    prompt_length: prompt.length,
    workspace_path: session.workspace_path,
  });

  const textParts: string[] = [];
  let lastProgressAt = 0;
  const PROGRESS_INTERVAL_MS = 30_000;

  try {
    for await (const msg of query({
      prompt,
      options: {
        systemPrompt,
        cwd: session.workspace_path,
        allowedTools: ['Read', 'Edit', 'Bash', 'Glob', 'Grep', 'Write'],
        permissionMode: 'acceptEdits',
        model: DEFAULT_LLM_MODEL,
        env: {
          ...process.env,
          ...LLM_ENV,
          TICLAW_RUNTIME_ID: session.runtime_id,
          TICLAW_AGENT_ID: session.agent_id,
          TICLAW_SESSION_ID: session.session_id,
          TICLAW_JOB_ID: session.job_id,
        } as Record<string, string>,
      },
    })) {
      const elapsed = Date.now() - start;
      const msgType = (msg as any).type;

      if (msgType === 'assistant') {
        const blocks = (msg as any).message?.content ?? [];
        for (const block of blocks) {
          if (block.type !== 'text' || !block.text) continue;
          textParts.push(block.text);
          if (onProgress && elapsed - lastProgressAt >= PROGRESS_INTERVAL_MS) {
            lastProgressAt = elapsed;
            appendJobLog(session, {
              phase: 'progress',
              elapsed_ms: elapsed,
              text: block.text,
            });
            await onProgress(block.text, elapsed);
          }
        }
      }

      if (msgType === 'result') {
        const resultMsg = msg as SDKResultMessage;
        const finalText =
          (resultMsg as any).result?.trim() ||
          textParts.join('\n').trim() ||
          '(done)';
        appendJobLog(session, {
          phase: 'done',
          elapsed_ms: elapsed,
          subtype: (resultMsg as any).subtype,
          result: finalText,
        });
        log.info({ elapsed, subtype: (resultMsg as any).subtype }, 'runAgent: done');
        await onReply(finalText);
        return;
      }
    }

    const finalText = textParts.join('\n').trim() || '(done)';
    appendJobLog(session, {
      phase: 'done',
      elapsed_ms: Date.now() - start,
      result: finalText,
    });
    await onReply(finalText);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    appendJobLog(session, {
      phase: 'error',
      elapsed_ms: Date.now() - start,
      error: message,
    });
    log.error({ err: message }, 'runAgent: failed');
    await onReply(`Error: ${message}`);
  }
}
