import { AgentRunner } from './runner.js';
import { logger } from './logger.js';
import { getSession, ensureSession } from './store.js';
import type { NewMessage, RunnerState } from './types.js';

export interface DispatcherDependencies {
  broadcastToChat: (chatJid: string, event: object) => void;
  sendMessage: (jid: string, text: string) => Promise<void>;
}

/** A pending message that arrived while the runner was busy. */
interface PendingMsg {
  chatJid: string;
  msg: NewMessage;
}

/**
 * Dispatcher: The central "Heart" (中枢) that coordinates Agents across all channels.
 * It manages individual AgentRunner instances, ensuring context isolation by Session Key.
 *
 * Queuing behaviour (single-slot per session):
 *   - If a runner is busy and the new message is NOT an urgent interrupt, it is held
 *     in a single-slot pending queue (newer message replaces older pending one).
 *   - When the runner becomes idle after a run, we drain the queue automatically.
 *   - This ensures rapid consecutive messages (e.g. multi-turn tests, human typing) are
 *     never silently dropped, while preserving the single-threaded agent execution model.
 */
export class Dispatcher {
  private runners = new Map<string, AgentRunner>();
  private pending = new Map<string, PendingMsg>(); // single-slot queue per session key
  private deps: DispatcherDependencies;

  constructor(deps: DispatcherDependencies) {
    this.deps = deps;
  }

  /**
   * Dispatches an inbound message to the appropriate AgentRunner.
   * Session isolation is strictly enforced via `${agent_id}:${session_id}` keying.
   */
  async dispatch(chatJid: string, msg: NewMessage): Promise<void> {
    const { agent_id, session_id, content, task_id } = msg;

    if (!agent_id || !session_id) {
      logger.error(
        { chat_jid: chatJid },
        'Dispatcher: Cannot dispatch message without agent_id or session_id',
      );
      return;
    }

    // 1. Lifecycle: Ensure session is persistent and active
    ensureSession({
      agent_id,
      session_id,
      channel: msg.chat_jid.startsWith('web:') ? 'web' : 'external',
      agent_name: agent_id,
    });

    // 2. Isolation: Get or instantiate a unique Runner for this session
    const runnerKey = `${agent_id}:${session_id}`;
    let runner = this.runners.get(runnerKey);

    if (!runner) {
      logger.info(
        { agent_id, session_id },
        'Dispatcher: Spawning new AgentRunner for session',
      );
      runner = new AgentRunner(agent_id, session_id, {
        onStateChange: (state: RunnerState) => {
          // Precise Telemetry: Push JSON status updates to the originating channel
          this.deps.broadcastToChat(chatJid, {
            type: 'runner_state',
            chat_jid: chatJid,
            ...state,
          });
        },
        onReply: async (text: string) => {
          // Reply Routing: Send response back to the correct chat JID
          await this.deps.sendMessage(chatJid, text);
        },
        onFile: this.deps.sendMessage
          ? async (filePath: string, caption?: string) => {
              // Forward file path as a ticlaw:// URL message to the originating channel
              const fileRef = caption ? `${caption}: ${filePath}` : filePath;
              await this.deps.sendMessage(chatJid, fileRef);
            }
          : undefined,
      });
      this.runners.set(runnerKey, runner);
    }

    // 3. Preemption / Queuing: Handle new messages while runner is busy
    const status = runner.getState().status;
    if (status === 'busy') {
      if (this.isUrgentInterrupt(content)) {
        logger.info(
          { agent_id, session_id },
          'Dispatcher: Urgent interruption triggered via message',
        );
        runner.interrupt();
        // Give the runner time to cleanup/abort gracefully before taking the new message
        await new Promise((resolve) => setTimeout(resolve, 800));
      } else {
        // Single-slot queue: hold message, drain after current run finishes.
        // If there was already a pending message it is replaced (last-write-wins).
        logger.info(
          { agent_id, session_id },
          'Dispatcher: Runner busy — queuing message (will deliver when idle)',
        );
        this.pending.set(runnerKey, { chatJid, msg });
        return;
      }
    }

    // 4. Execution: Pass the message into the Agent Loop
    await this._run(runner, runnerKey, chatJid, msg);
  }

  /** Execute a run and drain any pending message afterwards. */
  private async _run(
    runner: AgentRunner,
    runnerKey: string,
    chatJid: string,
    msg: NewMessage,
  ): Promise<void> {
    try {
      await runner.run([{ role: 'user', content: msg.content }], msg.task_id);
    } catch (err: any) {
      if (err.message?.includes('aborted')) {
        logger.debug(
          { runnerKey },
          'Dispatcher: Task was successfully aborted',
        );
      } else {
        logger.error({ err, runnerKey }, 'Dispatcher: Runner execution failed');
        await this.deps.sendMessage(chatJid, `Task Error: ${err.message}`);
      }
    }

    // 5. Drain queue: if a message arrived while we were running, process it now
    const queued = this.pending.get(runnerKey);
    if (queued) {
      this.pending.delete(runnerKey);
      logger.info({ runnerKey }, 'Dispatcher: Draining queued message');
      await this._run(runner, runnerKey, queued.chatJid, queued.msg);
    }
  }

  /**
   * Determine if a message content should preempt a running task.
   */
  private isUrgentInterrupt(content: string): boolean {
    const patterns = [
      /stop/i,
      /interrupt/i,
      /cancel/i,
      /wait/i,
      /打断/,
      /停止/,
      /取消/,
    ];
    return patterns.some((p) => p.test(content));
  }

  /**
   * Optional: Clean up idle runners to save memory.
   */
  public gc(): void {
    for (const [key, runner] of this.runners.entries()) {
      if (runner.getState().status === 'idle') {
        // Only cleanup if idle for some threshold (Logic not implemented yet)
      }
    }
  }
}
