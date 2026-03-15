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
      },
    });
    await runner.run(task.prompt, task.id);
  } catch (err) {
    logger.error({ err }, 'Task Execution Failed');
  }
}

export function submitTask(input: any): any {
  return { id: 'stub' };
}
import { getSessionsForAgent } from './core/store.js';
import type { ScheduleRecord } from './core/types.js';

export function submitScheduleTask(schedule: ScheduleRecord): any {
  // Execute asynchronously in the background
  (async () => {
    try {
      let runSessionId = `cron_${schedule.id}`; // Default isolated

      if (schedule.session === 'main') {
        const activeSessions = getSessionsForAgent(schedule.agent_id);
        if (activeSessions.length > 0) {
          runSessionId = activeSessions[0].session_id;
        }
      }

      const runner = new AgentRunner(schedule.agent_id, runSessionId, {
        onReply: async (text) => {
          logger.info(
            { scheduleId: schedule.id, text },
            'Schedule Execution Reply',
          );
        },
      });
      logger.info(
        { scheduleId: schedule.id, runSessionId, prompt: schedule.prompt },
        'Starting scheduled task',
      );
      await runner.run(
        schedule.prompt,
        `schedule-${schedule.id}-${Date.now()}`,
      );
    } catch (err) {
      logger.error(
        { err, scheduleId: schedule.id },
        'Scheduled task execution failed',
      );
    }
  })();
  return { id: `schedule-task-${schedule.id}` };
}
export function getActiveTaskById(id: string): any {
  return null;
}
export function listActiveTasks() {
  return [];
}
export function getExecutorStats() {
  return {};
}
