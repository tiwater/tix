/**
 * Task Executor - Sync Stub Fix
 */
import { runAgent } from './run-agent.js';
import { logger } from './core/logger.js';

export async function executeTask(task: any) {
  try {
    await runAgent({
      agentId: task.agent_id,
      sessionId: task.session_id,
      message: task.prompt,
      taskId: task.id,
      onReply: async (text) => {
        logger.info({ taskId: task.id, text }, 'Task Reply');
      }
    });
  } catch (err) {
    logger.error({ err }, 'Task Execution Failed');
  }
}

export function submitTask(input: any): any { return { id: 'stub' }; }
export function submitScheduleTask(input: any): any { return { id: 'stub' }; }
export function getActiveTaskById(id: string): any { return null; }
export function listActiveTasks() { return []; }
export function getExecutorStats() { return {}; }
