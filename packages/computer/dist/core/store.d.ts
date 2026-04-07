/**
 * Filesystem-based data store for Tix.
 *
 * Replaces SQLite (db.ts) with plain files:
 *   - agents/{id}/agent.json        → AgentRecord
 *   - agents/{id}/sessions/{sid}/   → session.json + messages.jsonl
 *   - agents/{id}/schedules/{id}.json → ScheduleRecord
 *   - router-state.json             → key-value pairs
 *   - registered groups             → agent.json `sources` field (future)
 *
 * Design philosophy: the filesystem IS the database.
 * See docs/data-management-design.md
 */
import type { AgentRecord, InteractionEvent, NewMessage, RegisteredProject, ScheduleRecord, SessionRecord } from './types.js';
/** Read last N lines from a JSONL file (efficient tail). */
declare function readJsonlTail<T>(filePath: string, limit: number): T[];
export declare function initStore(): void;
export declare function ensureAgent(input: {
    agent_id: string;
    name?: string;
    tags?: string[];
}): AgentRecord;
export declare function getAgent(agentId: string): AgentRecord | undefined;
export declare function getAllAgents(): AgentRecord[];
export declare function ensureSession(input: {
    agent_id: string;
    session_id: string;
    channel: string;
    source_ref?: string;
    agent_name?: string;
    status?: SessionRecord['status'];
}): SessionRecord;
export declare function getSession(sessionId: string): SessionRecord | undefined;
export declare function getSessionForAgent(agentId: string, sessionId: string): SessionRecord | undefined;
export declare function getSessionsForAgent(agentId: string): SessionRecord[];
export declare function getArchivedSessionsForAgent(agentId: string): SessionRecord[];
export declare function getAllSessions(): SessionRecord[];
export declare function updateSessionStatus(agentId: string, sessionId: string, status: SessionRecord['status']): void;
export declare function updateSessionUsage(agentId: string, sessionId: string, tokensIn: number, tokensOut: number): void;
export declare function getUsageStats(record: {
    tokens_in?: number;
    tokens_out?: number;
    agent_id?: string;
}): {
    tokens_in: number;
    tokens_out: number;
    tokens_total: number;
    estimated_cost_usd: number;
};
/** Get global usage across all agents and sessions. */
export declare function getGlobalUsage(): {
    tokens_in: any;
    tokens_out: any;
    tokens_total: any;
    estimated_cost_usd: any;
};
/** Get the full detailed daily usage ledger. */
export declare function getDailyUsage(): any;
/**
 * Reset sessions stuck as "running" — called at startup to recover from crashes.
 * A "running" session cannot survive a process restart, so these are stale.
 */
export declare function cleanupStaleSessions(): number;
export declare function updateSessionMetadata(agentId: string, sessionId: string, updates: Partial<SessionRecord>): boolean;
export declare function archiveSessionForAgent(agentId: string, sessionId: string): boolean;
export declare function restoreSessionForAgent(agentId: string, sessionId: string): boolean;
export declare function deleteSession(sessionId: string): void;
export declare function deleteSessionForAgent(agentId: string, sessionId: string, fromArchived?: boolean): boolean;
/** Resolve agent+session from chat_jid (format: "web:agent_id:session_id" or similar). */
export declare function resolveFromChatJid(chatJid: string): {
    agentId: string;
    sessionId: string;
} | null;
export declare function storeMessage(msg: NewMessage): void;
/** Alias for storeMessage — both had identical implementations in db.ts */
export declare const storeMessageDirect: typeof storeMessage;
export declare function getRecentMessages(chatJid: string, limit?: number): NewMessage[];
export declare function getMessagesSince(chatJid: string, sinceTimestamp: string, _botPrefix: string): NewMessage[];
export declare function getNewMessages(jids: string[], lastTimestamp: string, botPrefix: string): {
    messages: NewMessage[];
    newTimestamp: string;
};
export declare function createSchedule(input: {
    agent_id: string;
    cron: string;
    prompt: string;
    type?: 'cron' | 'one-shot';
    session?: 'main' | 'isolated';
    target_jid?: string;
    next_run?: string;
}): ScheduleRecord;
export declare function getScheduleById(id: string): ScheduleRecord | undefined;
export declare function getAllSchedules(): ScheduleRecord[];
export declare function getSchedulesForAgent(agentId: string): ScheduleRecord[];
export declare function getDueSchedules(forceAll?: boolean): ScheduleRecord[];
export declare function updateSchedule(id: string, updates: Partial<Pick<ScheduleRecord, 'prompt' | 'cron' | 'next_run' | 'status' | 'type' | 'session' | 'delete_after_run' | 'last_run'>>): void;
export declare function updateScheduleAfterRun(id: string, nextRun: string | null): void;
export declare function deleteSchedule(id: string): void;
export declare function getRouterState(key: string): string | undefined;
export declare function setRouterState(key: string, value: string): void;
export declare function getAllRouterState(): Record<string, string>;
export declare function getRegisteredProject(jid: string): (RegisteredProject & {
    jid: string;
}) | undefined;
export declare function setRegisteredProject(jid: string, group: RegisteredProject): void;
export declare function getAllRegisteredProjects(): Record<string, RegisteredProject>;
export declare function storeChatMetadata(chatJid: string, timestamp: string, name?: string, channel?: string, _isGroup?: boolean): void;
export declare function updateChatName(chatJid: string, name: string): void;
export interface ChatInfo {
    jid: string;
    name: string;
    last_message_time: string;
    channel: string;
    is_group: number;
}
export declare function getAllChats(): ChatInfo[];
export declare function getLastGroupSync(): string | null;
export declare function setLastGroupSync(): void;
export declare function storeInteractionEvent(event: InteractionEvent): void;
export declare function getRecentInteractionEvents(chatJid: string, limit?: number): InteractionEvent[];
export declare const __testOnly: {
    readJsonlTail: typeof readJsonlTail;
};
export {};
//# sourceMappingURL=store.d.ts.map