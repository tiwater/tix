/**
 * runAgent — lean replacement for the old runAgentOrchestrator.
 *
 * Calls the Claude Agent SDK query() directly. No subprocess, no tmux,
 * no separate executor layer. Claude handles Bash / Read / Edit / Glob
 * natively through its own tool loop.
 *
 * Mind files are loaded from the agent workspace (agentPaths convention).
 */

import fs from 'fs';
import path from 'path';

import { query } from '@anthropic-ai/claude-agent-sdk';
import type { Query, SDKResultMessage } from '@anthropic-ai/claude-agent-sdk';
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
  agentPaths,
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
  onEvent?: (event: Record<string, unknown>) => Promise<void> | void;
  signal?: AbortSignal;
}

export function safeLogFileSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64) || 'task';
}

export function getTaskLogPath(
  session: Pick<SessionContext, 'agent_id' | 'task_id'>,
): string {
  const paths = agentPaths(session.agent_id);
  return path.join(paths.logs, `${safeLogFileSegment(session.task_id)}.jsonl`);
}

export function appendTaskLog(
  session: SessionContext,
  event: Record<string, unknown>,
): void {
  const paths = agentPaths(session.agent_id);
  fs.mkdirSync(paths.logs, { recursive: true });
  const logPath = getTaskLogPath(session);
  fs.appendFileSync(
    logPath,
    `${JSON.stringify({
      ts: new Date().toISOString(),
      agent_id: session.agent_id,
      session_id: session.session_id,
      task_id: session.task_id,
      ...event,
    })}\n`,
    'utf-8',
  );
}

/** @deprecated Use appendTaskLog */
export const appendJobLog = appendTaskLog;

function bootstrapAgentMindFiles(
  group: RegisteredProject,
  session: SessionContext,
): void {
  const paths = agentPaths(session.agent_id);
  fs.mkdirSync(paths.workspace, { recursive: true });
  fs.mkdirSync(paths.logs, { recursive: true });

  const sourceDirs = [path.join(AGENTS_DIR, group.folder), AGENTS_DIR];

  for (const filename of AGENT_MIND_FILES) {
    const dest = path.join(paths.workspace, filename);
    if (fs.existsSync(dest)) continue;

    const source = sourceDirs
      .map((dir) => path.join(dir, filename))
      .find((candidate) => fs.existsSync(candidate));

    if (source) {
      fs.copyFileSync(source, dest);
    }
  }

  const memoryPath = path.join(paths.workspace, 'MEMORY.md');
  if (!fs.existsSync(memoryPath)) {
    fs.writeFileSync(
      memoryPath,
      '# MEMORY\n\nSession-local working memory.\n',
      'utf-8',
    );
  }
}

function loadSessionMindContext(
  group: RegisteredProject,
  session: SessionContext,
): string {
  const paths = agentPaths(session.agent_id);
  const parts: string[] = [];
  for (const filename of AGENT_MIND_FILES) {
    const filePath = path.join(paths.workspace, filename);
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
    `You are ${ASSISTANT_NAME} 🦀, a mind assistant built with TiClaw.\n` +
    `Work only inside the provided session workspace directory.\n` +
    `Be concise and helpful.\n` +
    `You can read, edit, run bash commands, and search the workspace.` +
    `\n\nFor persona or memory changes requested by users, directly update the ` +
    `relevant mind files (SOUL.md, MEMORY.md) in the workspace directory.`;

  const mindContext = loadSessionMindContext(group, session);
  return mindContext ? `${base}\n\n${mindContext}` : base;
}

function serializeEventValue(value: unknown): unknown {
  if (value === undefined) return undefined;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return String(value);
  }
}

function extractToolCall(block: any): Record<string, unknown> | null {
  if (!block || typeof block !== 'object') return null;
  if (
    block.type !== 'tool_use' &&
    block.type !== 'server_tool_use' &&
    block.type !== 'mcp_tool_use'
  ) {
    return null;
  }

  return {
    id: block.id || block.tool_use_id || null,
    name: block.name || block.tool_name || 'tool',
    arguments: serializeEventValue(block.input ?? block.arguments ?? {}),
  };
}

function extractToolResult(msg: any): Record<string, unknown> | null {
  if (!msg || typeof msg !== 'object') return null;

  const toolCallId =
    typeof msg.parent_tool_use_id === 'string' && msg.parent_tool_use_id
      ? msg.parent_tool_use_id
      : typeof msg.tool_use_id === 'string' && msg.tool_use_id
        ? msg.tool_use_id
        : null;
  if (!toolCallId) return null;

  const result =
    msg.tool_use_result ??
    msg.message?.content ??
    msg.content ??
    msg.result ??
    null;

  return {
    tool_call_id: toolCallId,
    result: serializeEventValue(result),
    is_error: false,
  };
}

export async function runAgent(opts: RunAgentOpts): Promise<void> {
  const { group, session, messages, onProgress, onReply, onEvent, signal } =
    opts;
  const paths = agentPaths(session.agent_id);
  const log = logger.child({
    agent_id: session.agent_id,
    session_id: session.session_id,
    task_id: session.task_id,
  });
  const start = Date.now();

  const lastUser = messages.filter((message) => message.role === 'user').at(-1);
  if (!lastUser) {
    appendTaskLog(session, { phase: 'done', result: '(no message)' });
    await onEvent?.({ phase: 'done', result: '(no message)' });
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
      workspace: paths.workspace,
      model: DEFAULT_LLM_MODEL ?? 'default',
    },
    'runAgent: start',
  );
  appendTaskLog(session, {
    phase: 'start',
    prompt_length: prompt.length,
    workspace: paths.workspace,
  });
  await onEvent?.({
    phase: 'start',
    prompt_length: prompt.length,
    workspace: paths.workspace,
  });

  const textParts: string[] = [];
  let lastProgressAt = 0;
  const PROGRESS_INTERVAL_MS = 30_000;
  const agentQuery = query({
    prompt,
    options: {
      systemPrompt,
      cwd: paths.workspace,
      allowedTools: ['Read', 'Edit', 'Bash', 'Glob', 'Grep', 'Write'],
      permissionMode: 'acceptEdits',
      model: DEFAULT_LLM_MODEL,
      includePartialMessages: true,
      env: {
        ...process.env,
        ...LLM_ENV,
        TICLAW_AGENT_ID: session.agent_id,
        TICLAW_SESSION_ID: session.session_id,
        TICLAW_TASK_ID: session.task_id,
      } as Record<string, string>,
    },
  });

  const abortQuery = () => {
    try {
      (agentQuery as Query).close();
    } catch {
      /* ignore */
    }
  };
  signal?.addEventListener('abort', abortQuery, { once: true });

  try {
    for await (const msg of agentQuery) {
      if (signal?.aborted) {
        throw signal.reason instanceof Error
          ? signal.reason
          : new Error(String(signal.reason || 'Task aborted'));
      }

      const elapsed = Date.now() - start;
      const msgType = (msg as any).type;

      // Handle streaming text deltas from SDK
      if (msgType === 'stream_event') {
        const event = (msg as any).event;
        if (event?.type === 'content_block_delta' && event?.delta?.type === 'text_delta') {
          await onEvent?.({
            phase: 'stream_delta',
            text: event.delta.text,
          });
        }
        continue;
      }

      await onEvent?.({
        phase: 'activity',
        elapsed_ms: elapsed,
        type: msgType,
      });

      if (msgType === 'assistant') {
        const blocks = (msg as any).message?.content ?? [];
        for (const block of blocks) {
          const toolCall = extractToolCall(block);
          if (toolCall) {
            await onEvent?.({
              phase: 'tool_call',
              elapsed_ms: elapsed,
              tool_calls: [toolCall],
            });
            continue;
          }

          if (block.type !== 'text' || !block.text) continue;
          textParts.push(block.text);
          await onEvent?.({
            phase: 'message_delta',
            elapsed_ms: elapsed,
            role: 'assistant',
            content: [
              {
                type: 'markdown',
                text: block.text,
              },
            ],
          });
          if (onProgress && elapsed - lastProgressAt >= PROGRESS_INTERVAL_MS) {
            lastProgressAt = elapsed;
            appendTaskLog(session, {
              phase: 'progress',
              elapsed_ms: elapsed,
              text: block.text,
            });
            await onEvent?.({
              phase: 'progress',
              elapsed_ms: elapsed,
              text: block.text,
            });
            await onProgress(block.text, elapsed);
          }
        }
      }

      if (msgType === 'user') {
        const toolResult = extractToolResult(msg as any);
        if (toolResult) {
          await onEvent?.({
            phase: 'tool_result',
            elapsed_ms: elapsed,
            tool_results: [toolResult],
          });
        }
      }

      if (msgType === 'result') {
        const resultMsg = msg as SDKResultMessage;
        const finalText =
          (resultMsg as any).result?.trim() ||
          textParts.join('\n').trim() ||
          '(done)';
        appendTaskLog(session, {
          phase: 'done',
          elapsed_ms: elapsed,
          subtype: (resultMsg as any).subtype,
          result: finalText,
        });
        await onEvent?.({
          phase: 'done',
          elapsed_ms: elapsed,
          subtype: (resultMsg as any).subtype,
          result: finalText,
        });
        log.info(
          { elapsed, subtype: (resultMsg as any).subtype },
          'runAgent: done',
        );
        await onReply(finalText);
        return;
      }
    }

    const finalText = textParts.join('\n').trim() || '(done)';
    appendTaskLog(session, {
      phase: 'done',
      elapsed_ms: Date.now() - start,
      result: finalText,
    });
    await onEvent?.({
      phase: 'done',
      elapsed_ms: Date.now() - start,
      result: finalText,
    });
    await onReply(finalText);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    appendTaskLog(session, {
      phase: 'error',
      elapsed_ms: Date.now() - start,
      error: message,
    });
    await onEvent?.({
      phase: 'error',
      elapsed_ms: Date.now() - start,
      error: message,
    });
    log.error({ err: message }, 'runAgent: failed');
    throw err;
  } finally {
    signal?.removeEventListener('abort', abortQuery);
  }
}
