/**
 * Sub-agent delegation — allows one agent to delegate a task to another
 * agent on the same runtime via the job executor.
 *
 * Uses the existing job infrastructure:
 *  1. Creates a job targeting a different agent_id
 *  2. Polls for completion
 *  3. Returns the result or throws on failure
 *
 * Delegation depth is capped at MAX_DELEGATION_DEPTH to prevent loops.
 */

import { getJobById } from './core/db.js';
import { logger } from './core/logger.js';
import { submitJob } from './job-executor.js';
import type { JobRecord, SessionContext } from './core/types.js';

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
  jobId: string;
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
  jobId: string;
  constructor(jobId: string, timeoutMs: number) {
    super(`Sub-agent delegation timed out after ${timeoutMs}ms (job ${jobId})`);
    this.name = 'DelegationTimeoutError';
    this.jobId = jobId;
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

  // Submit a job targeting the other agent
  const job = submitJob({
    runtime_id: opts.parentSession.runtime_id,
    agent_id: opts.targetAgentId,
    session_id: `delegated:${opts.parentSession.session_id}:${Date.now()}`,
    chat_jid: opts.parentSession.chat_jid,
    prompt: `[DELEGATED from agent="${opts.parentSession.agent_id}" depth=${depth + 1}]\n${opts.prompt}`,
    source: 'api',
    source_ref: `delegation:${opts.parentSession.job_id}`,
    submitted_by: opts.parentSession.agent_id,
    submitter_type: 'agent',
    idempotency_key: `delegate:${opts.parentSession.job_id}:${opts.targetAgentId}:${Date.now()}`,
    timeout_ms: timeoutMs,
    metadata: {
      delegation_depth: depth + 1,
      parent_job_id: opts.parentSession.job_id,
      parent_agent_id: opts.parentSession.agent_id,
    },
  });

  // Poll for completion
  const result = await pollJobCompletion(
    job.id,
    timeoutMs,
    startMs,
    opts.signal,
  );

  logger.info(
    {
      jobId: job.id,
      status: result.status,
      durationMs: result.durationMs,
    },
    'sub-agent delegation completed',
  );

  return result;
}

async function pollJobCompletion(
  jobId: string,
  timeoutMs: number,
  startMs: number,
  signal?: AbortSignal,
): Promise<DelegationResult> {
  while (true) {
    if (signal?.aborted) {
      return {
        jobId,
        status: 'canceled',
        error: 'Parent agent was canceled',
        durationMs: Date.now() - startMs,
      };
    }

    const elapsed = Date.now() - startMs;
    if (elapsed >= timeoutMs) {
      throw new DelegationTimeoutError(jobId, timeoutMs);
    }

    const job = getJobById(jobId);
    if (!job) {
      return {
        jobId,
        status: 'failed',
        error: 'Delegated job not found',
        durationMs: Date.now() - startMs,
      };
    }

    if (isTerminal(job.status)) {
      return {
        jobId,
        status: job.status as DelegationResult['status'],
        resultText: job.result?.text,
        error: job.error?.message,
        durationMs: Date.now() - startMs,
      };
    }

    await sleep(POLL_INTERVAL_MS);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
