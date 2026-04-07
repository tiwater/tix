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
import type { SessionContext } from './core/types.js';
export declare const MAX_DELEGATION_DEPTH = 3;
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
export declare class DelegationDepthExceededError extends Error {
    constructor(depth: number);
}
export declare class DelegationTimeoutError extends Error {
    taskId: string;
    constructor(taskId: string, timeoutMs: number);
}
/**
 * Delegate a task to another agent and wait for the result.
 */
export declare function delegateToAgent(opts: DelegateOpts): Promise<DelegationResult>;
//# sourceMappingURL=sub-agent.d.ts.map