/**
 * run-agent.ts — Compatibility shim.
 *
 * Bridges the legacy `runAgent()` call-signature used by index.ts and
 * task-executor.ts to the new AgentRunner class in core/runner.ts.
 */
import fs from 'fs';
import path from 'path';
import { AgentRunner } from './core/runner.js';
import { agentPaths } from './core/config.js';
import { logger } from './core/logger.js';
import type { RegisteredProject, SessionContext } from './core/types.js';

export interface RunAgentOptions {
  group: RegisteredProject;
  session: SessionContext;
  messages: Array<{ role: string; content: string }>;
  signal?: AbortSignal;
  onEvent?: (event: Record<string, unknown>) => void | Promise<void>;
  onProgress?: (text: string, elapsed: number) => void | Promise<void>;
  onReply?: (text: string) => void | Promise<void>;
}

/**
 * Run the agent using the new AgentRunner, preserving the old call interface.
 */
export async function runAgent(opts: RunAgentOptions): Promise<void> {
  const { group, session, messages, onEvent, onReply } = opts;

  const agentId = (group as any).agent_id || group.folder;

  const runner = new AgentRunner(agentId, session.session_id, {
    onStateChange: async (state) => {
      if (onEvent) {
        await onEvent({
          phase: state.activity?.phase,
          action: state.activity?.action,
          target: state.activity?.target,
          elapsed_ms: state.activity?.elapsed_ms,
          status: state.status,
        });
      }
    },
    onReply: async (text) => {
      if (onReply) await onReply(text);
    },
  });

  // Combine all user messages into a single prompt for the runner
  const prompt = messages
    .filter((m) => m.role === 'user')
    .map((m) => m.content)
    .join('\n\n');

  await runner.run(prompt, session.task_id);
}

/**
 * Returns the log path for a given task (used by http.ts).
 */
export function getTaskLogPath(agentId: string, taskId: string): string {
  const paths = agentPaths(agentId);
  return path.join(paths.base, 'logs', `${taskId}.log`);
}

/**
 * Appends a line to a task's log file.
 */
export function appendJobLog(
  agentId: string,
  taskId: string,
  line: string,
): void {
  const logPath = getTaskLogPath(agentId, taskId);
  const dir = path.dirname(logPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(logPath, `${line}\n`, 'utf-8');
}
