import type { Query } from '@anthropic-ai/claude-agent-sdk';
import type { ComputerState } from './types.js';
declare function getPromptMtimeKey(baseDir: string): string;
interface WarmSession {
    query: Query;
    agentId: string;
    sessionId: string;
    createdAt: number;
    lastUsedAt: number;
    /** When the most recent SDK event arrived. Used for liveness tracking. */
    lastEventAt: number;
    /** Whether the background output loop is still running. */
    alive: boolean;
}
declare function buildSessionKey(agentId: string, sessionId: string): string;
declare function getClaudeSessionPath(agentId: string, sessionId: string): string;
export declare const __testOnly: {
    buildSessionKey: typeof buildSessionKey;
    getPromptMtimeKey: typeof getPromptMtimeKey;
    getClaudeSessionPath: typeof getClaudeSessionPath;
};
/**
 * Returns the warm session for a given agent + session, if one exists.
 * Used by the HTTP channel to call getContextUsage() on the active Query object.
 */
export declare function getWarmSession(agentId: string, sessionId: string): WarmSession | undefined;
export interface ComputerEvents {
    onStateChange?: (state: ComputerState) => void | Promise<void>;
    onReply?: (text: string) => void | Promise<void>;
    onFile?: (filePath: string, caption?: string) => void | Promise<void>;
}
/**
 * AgentComputer: The refined functional "Body" of a Tix Agent.
 *
 * Warm-session pool behaviour:
 *   - Key is `${agentId}:${sessionId}` → one subprocess per session
 *   - First call: cold start, subprocess spawned with the latest prompt
 *   - Subsequent calls within the same process: warm path via streamInput()
 *   - After process restart: cold start with `resume: <savedClaudeSessionId>`
 *     to restore full conversation context from the server
 *   - If streamInput() fails: falls back to cold resume automatically
 */
export declare class AgentComputer {
    private state;
    private controller;
    private events;
    private lastInputTokens;
    private lastOutputTokens;
    constructor(agentId: string, sessionId: string, events?: ComputerEvents);
    getState(): ComputerState;
    /**
     * Primary entry point: Executes a user message through the Agent Loop.
     * First call spawns the subprocess; subsequent calls reuse it via streamInput().
     */
    run(messages: Array<{
        role: string;
        content: string;
    }>, taskId?: string, options?: {
        model?: string;
    }): Promise<void>;
    /**
     * Preemptively stop the current task.
     */
    interrupt(): void;
    /**
     * Initializes the "Brain" directory structure and essential files.
     */
    private initBrain;
    /**
     * Builds the system prompt with caching (invalidated by mtime).
     */
    private preparePrompt;
    /**
     * Maps Executor (Claude SDK) events to internal Telemetry State.
     */
    private handleExecutorEvent;
    /**
     * Consolidates task results into a per-day short-term memory journal.
     * Categorizes facts and automatically escalates critical ones to MEMORY.md.
     */
    private consolidateMemory;
    /**
     * Integrates specific high-importance facts into the long-term MEMORY.md file.
     */
    private escalateToCoreMemory;
    private notifyState;
}
export {};
//# sourceMappingURL=computer.d.ts.map