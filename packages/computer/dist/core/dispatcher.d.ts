import type { NewMessage } from './types.js';
export interface DispatcherDependencies {
    broadcastToChat: (chatJid: string, event: object) => void;
    sendMessage: (jid: string, text: string) => Promise<void>;
}
/**
 * Dispatcher: The central "Heart" (中枢) that coordinates Agents across all channels.
 * It manages individual AgentComputer instances, ensuring context isolation by Session Key.
 *
 * Queuing behaviour (single-slot per session):
 *   - If a computer is busy and the new message is NOT an urgent interrupt, it is held
 *     in a single-slot pending queue (newer message replaces older pending one).
 *   - When the computer becomes idle after a run, we drain the queue automatically.
 *   - This ensures rapid consecutive messages (e.g. multi-turn tests, human typing) are
 *     never silently dropped, while preserving the single-threaded agent execution model.
 */
export declare class Dispatcher {
    private computers;
    private pending;
    private deps;
    private readonly MAX_QUEUE_SIZE;
    private readonly IDLE_TTL_MS;
    constructor(deps: DispatcherDependencies);
    /**
     * Dispatches an inbound message to the appropriate AgentComputer.
     * Session isolation is strictly enforced via `${agent_id}:${session_id}` keying.
     */
    dispatch(chatJid: string, msg: NewMessage): Promise<void>;
    /** Execute a run and drain any pending message afterwards. */
    private _run;
    /**
     * Determine if a message content should preempt a running task.
     */
    private isUrgentInterrupt;
    /**
     * Clean up idle computers to save memory.
     */
    gc(): void;
}
//# sourceMappingURL=dispatcher.d.ts.map