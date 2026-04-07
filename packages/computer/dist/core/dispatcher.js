import { AgentComputer } from './computer.js';
import { isUrgentInterruptMessage } from './interrupts.js';
import { logger } from './logger.js';
import { ensureSession } from './store.js';
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
export class Dispatcher {
    computers = new Map();
    pending = new Map(); // FIFO queue per session key
    deps;
    MAX_QUEUE_SIZE = 10;
    IDLE_TTL_MS = 30 * 60 * 1000; // 30 minutes
    constructor(deps) {
        this.deps = deps;
        // Periodic GC
        setInterval(() => this.gc(), 5 * 60 * 1000); // Every 5 minutes
    }
    /**
     * Dispatches an inbound message to the appropriate AgentComputer.
     * Session isolation is strictly enforced via `${agent_id}:${session_id}` keying.
     */
    async dispatch(chatJid, msg) {
        const { agent_id, session_id, content, task_id } = msg;
        if (!agent_id || !session_id) {
            logger.error({ chat_jid: chatJid }, 'Dispatcher: Cannot dispatch message without agent_id or session_id');
            return;
        }
        // 1. Lifecycle: Ensure session is persistent and active
        ensureSession({
            agent_id,
            session_id,
            channel: msg.chat_jid.startsWith('web:') ? 'web' : 'external',
            agent_name: agent_id,
        });
        // 2. Isolation: Get or instantiate a unique Computer for this session
        const computerKey = `${agent_id}:${session_id}`;
        let computer = this.computers.get(computerKey);
        if (!computer) {
            logger.info({ agent_id, session_id }, 'Dispatcher: Spawning new AgentComputer for session');
            computer = new AgentComputer(agent_id, session_id, {
                onStateChange: (state) => {
                    // Precise Telemetry: Push JSON status updates to the originating channel
                    this.deps.broadcastToChat(chatJid, {
                        type: 'computer_state',
                        chat_jid: chatJid,
                        ...state,
                    });
                },
                onReply: async (text) => {
                    // Reply Routing: Send response back to the correct chat JID
                    await this.deps.sendMessage(chatJid, text);
                },
                onFile: this.deps.sendMessage
                    ? async (filePath, caption) => {
                        // Forward file path as a tix:// URL message to the originating channel
                        const fileRef = caption ? `${caption}: ${filePath}` : filePath;
                        await this.deps.sendMessage(chatJid, fileRef);
                    }
                    : undefined,
            });
            this.computers.set(computerKey, computer);
        }
        // 3. Preemption / Queuing: Handle new messages while computer is busy
        const status = computer.getState().status;
        if (status === 'busy') {
            if (this.isUrgentInterrupt(content)) {
                logger.info({ agent_id, session_id }, 'Dispatcher: Urgent interruption triggered via message');
                computer.interrupt();
                // Wait for computer to acknowledge interruption or timeout
                let attempts = 0;
                while (computer.getState().status === 'busy' && attempts < 20) {
                    await new Promise((resolve) => setTimeout(resolve, 100));
                    attempts++;
                }
            }
            else {
                // FIFO queue: hold message, drain after current run finishes.
                logger.info({ agent_id, session_id }, 'Dispatcher: Computer busy — queuing message (will deliver when idle)');
                let queue = this.pending.get(computerKey) || [];
                if (queue.length >= this.MAX_QUEUE_SIZE) {
                    logger.warn({ computerKey }, 'Dispatcher: Queue overflow, dropping oldest message');
                    queue.shift();
                }
                queue.push({ chatJid, msg });
                this.pending.set(computerKey, queue);
                return;
            }
        }
        // 4. Execution: Pass the message into the Agent Loop
        await this._run(computer, computerKey, chatJid, msg);
    }
    /** Execute a run and drain any pending message afterwards. */
    async _run(computer, computerKey, chatJid, msg) {
        try {
            await computer.run([{ role: 'user', content: msg.content }], msg.task_id);
        }
        catch (err) {
            if (err.message?.includes('aborted') || err.message?.includes('interrupted')) {
                logger.debug({ computerKey }, 'Dispatcher: Task was successfully aborted');
            }
            else {
                logger.error({ err, computerKey }, 'Dispatcher: Computer execution failed');
                await this.deps.sendMessage(chatJid, `Task Error: ${err.message}`);
            }
        }
        // 5. Drain queue: if messages arrived while we were running, process them in order
        const queue = this.pending.get(computerKey);
        if (queue && queue.length > 0) {
            const next = queue.shift();
            if (queue.length === 0) {
                this.pending.delete(computerKey);
            }
            logger.info({ computerKey, remaining: queue.length }, 'Dispatcher: Draining queued message');
            await this._run(computer, computerKey, next.chatJid, next.msg);
        }
    }
    /**
     * Determine if a message content should preempt a running task.
     */
    isUrgentInterrupt(content) {
        return isUrgentInterruptMessage(content);
    }
    /**
     * Clean up idle computers to save memory.
     */
    gc() {
        const now = Date.now();
        for (const [key, computer] of this.computers.entries()) {
            const state = computer.getState();
            if (state.status !== 'busy') {
                const lastActivity = state.last_activity_at || 0;
                if (now - lastActivity > this.IDLE_TTL_MS) {
                    logger.info({ computerKey: key }, 'Dispatcher: GC cleaning up idle computer');
                    this.computers.delete(key);
                    this.pending.delete(key);
                }
            }
        }
    }
}
//# sourceMappingURL=dispatcher.js.map