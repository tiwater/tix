/**
 * Sub-agent delegation — allows one agent to delegate a task to another
 * agent via the task executor.
 *
 * Uses the in-memory task system:
 *  1. Submits a task targeting a different agent_id
 *  2. Polls for completion
 *  3. Returns the result or throws on failure
 *
 * Delegation depth is capped at MAX_DELEGATION_DEPTH to prevent loops.
 */

import { logger } from './core/logger.js';
import { submitTask, getActiveTaskById } from './task-executor.js';
import type { TaskRecord, SessionContext } from './core/types.js';

export const MAX_DELEGATION_DEPTH = 3;

const POLL_INTERVAL_MS = 500;
const DEFAULT_DELEGATION_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

export interface DelegateOpts {
  /** Session of the delegating (parent) agent */
  parentSession: SessionContext;
  /** Target agent_id to delegate to */
  targetAgentId: string;
  /** Task prompt to send to the target agent */
  prompt: string;
  /** Maximum wait time in ms (default: 5 minutes) */
  timeoutMs?: number;
  /** Current delegation depth (auto-tracked) */
  depth?: number;
  /** Optional abort signal to cancel the delegation */
  signal?: AbortSignal;
}

export interface DelegationResult {
  taskId: string;
  status: 'succeeded' | 'failed' | 'canceled' | 'timeout';
  resultText?: string;
  error?: string;
  durationMs: number;
}

export class DelegationDepthExceededError extends Error {
  constructor(depth: number) {
    super(
      `Sub-agent delegation depth ${depth} exceeds maximum of ${MAX_DELEGATION_DEPTH}`,
    );
    this.name = 'DelegationDepthExceededError';
  }
}

export class DelegationTimeoutError extends Error {
  taskId: string;
  constructor(taskId: string, timeoutMs: number) {
    super(
      `Sub-agent delegation timed out after ${timeoutMs}ms (task ${taskId})`,
    );
    this.name = 'DelegationTimeoutError';
    this.taskId = taskId;
  }
}

function isTerminal(status: string): boolean {
  return ['succeeded', 'failed', 'canceled', 'timeout'].includes(status);
}

/**
 * Delegate a task to another agent and wait for the result.
 */
export async function delegateToAgent(
  opts: DelegateOpts,
): Promise<DelegationResult> {
  const depth = opts.depth ?? 0;
  if (depth >= MAX_DELEGATION_DEPTH) {
    throw new DelegationDepthExceededError(depth);
  }

  const timeoutMs = opts.timeoutMs ?? DEFAULT_DELEGATION_TIMEOUT_MS;
  const startMs = Date.now();

  logger.info(
    {
      parentAgent: opts.parentSession.agent_id,
      targetAgent: opts.targetAgentId,
      depth,
      prompt: opts.prompt.slice(0, 200),
    },
    'sub-agent delegation started',
  );

  // Submit a task targeting the other agent
  const task = submitTask({
    agent_id: opts.targetAgentId,
    session_id: `delegated:${opts.parentSession.session_id}:${Date.now()}`,
    prompt: `[DELEGATED from agent="${opts.parentSession.agent_id}" depth=${depth + 1}]\n${opts.prompt}`,
    source: 'api',
    source_ref: `delegation:${opts.parentSession.task_id}`,
    submitted_by: opts.parentSession.agent_id,
    submitter_type: 'agent',
    idempotency_key: `delegate:${opts.parentSession.task_id}:${opts.targetAgentId}:${Date.now()}`,
    timeout_ms: timeoutMs,
    metadata: {
      delegation_depth: depth + 1,
      parent_task_id: opts.parentSession.task_id,
      parent_agent_id: opts.parentSession.agent_id,
    },
  });

  // Poll for completion
  const result = await pollTaskCompletion(
    task.id,
    timeoutMs,
    startMs,
    opts.signal,
  );

  logger.info(
    {
      taskId: task.id,
      status: result.status,
      durationMs: result.durationMs,
    },
    'sub-agent delegation completed',
  );

  return result;
}

async function pollTaskCompletion(
  taskId: string,
  timeoutMs: number,
  startMs: number,
  signal?: AbortSignal,
): Promise<DelegationResult> {
  while (true) {
    if (signal?.aborted) {
      return {
        taskId,
        status: 'canceled',
        error: 'Parent agent was canceled',
        durationMs: Date.now() - startMs,
      };
    }

    const elapsed = Date.now() - startMs;
    if (elapsed >= timeoutMs) {
      throw new DelegationTimeoutError(taskId, timeoutMs);
    }

    const task = getActiveTaskById(taskId);
    if (!task) {
      // Task completed and was removed from the queue
      return {
        taskId,
        status: 'succeeded',
        resultText: undefined,
        durationMs: Date.now() - startMs,
      };
    }

    if (isTerminal(task.status)) {
      return {
        taskId,
        status: task.status as DelegationResult['status'],
        resultText: task.result?.text,
        error: task.error?.message,
        durationMs: Date.now() - startMs,
      };
    }

    await sleep(POLL_INTERVAL_MS);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
