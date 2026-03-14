/**
 * Task Executor - Sync Implementation using AgentRunner
 */
import { AgentRunner } from './core/runner.js';
import { logger } from './core/logger.js';

export async function executeTask(task: any) {
  try {
    const runner = new AgentRunner(task.agent_id, task.session_id, {
      onReply: async (text) => {
        logger.info({ taskId: task.id, text }, 'Task Reply');
      }
    });
    await runner.run(task.prompt, task.id);
  } catch (err) {
    logger.error({ err }, 'Task Execution Failed');
  }
}

export function submitTask(input: any): any { return { id: 'stub' }; }
export function submitScheduleTask(input: any): any { return { id: 'stub' }; }
export function getActiveTaskById(id: string): any { return null; }
export function listActiveTasks() { return []; }
export function getExecutorStats() { return {}; }
