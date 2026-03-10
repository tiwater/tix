import {
  getAgent,
  getDueTasks,
  getSessionByScope,
  getTaskById,
  logTaskRun,
  updateTask,
} from './core/db.js';
import { logger } from './core/logger.js';
import { RegisteredProject } from './core/types.js';
import { submitScheduledTaskJob } from './job-executor.js';
import { SCHEDULER_POLL_INTERVAL } from './core/config.js';

export interface SchedulerDependencies {
  registeredProjects: () => Record<string, RegisteredProject>;
  sendMessage: (jid: string, text: string) => Promise<void>;
}

let schedulerRunning = false;

function pauseInvalidTask(
  taskId: string,
  scope: {
    runtime_id: string;
    agent_id: string;
    session_id: string;
    job_id: string;
  },
  error: string,
): void {
  updateTask(taskId, { status: 'paused', next_run: null });
  logTaskRun({
    runtime_id: scope.runtime_id,
    agent_id: scope.agent_id,
    session_id: scope.session_id,
    job_id: scope.job_id,
    task_id: taskId,
    run_at: new Date().toISOString(),
    duration_ms: 0,
    status: 'error',
    result: null,
    error,
  });
}

export function startSchedulerLoop(_deps: SchedulerDependencies): void {
  if (schedulerRunning) {
    logger.debug('Scheduler loop already running, skipping duplicate start');
    return;
  }
  schedulerRunning = true;
  logger.info('Scheduler loop started');

  const loop = async () => {
    try {
      const dueTasks = getDueTasks();
      if (dueTasks.length > 0) {
        logger.info({ count: dueTasks.length }, 'Found due tasks');
      }

      for (const task of dueTasks) {
        const currentTask = getTaskById(task.id);
        if (!currentTask || currentTask.status !== 'active') continue;

        const session = getSessionByScope(
          currentTask.runtime_id,
          currentTask.agent_id,
          currentTask.session_id,
        );
        if (!session || session.status !== 'active') {
          const error = session
            ? 'Session is not active'
            : 'Session not found for scheduled task';
          logger.error(
            {
              runtime_id: currentTask.runtime_id,
              agent_id: currentTask.agent_id,
              session_id: currentTask.session_id,
              task_id: currentTask.id,
              error,
            },
            'Task session unavailable',
          );
          pauseInvalidTask(
            currentTask.id,
            {
              runtime_id: currentTask.runtime_id,
              agent_id: currentTask.agent_id,
              session_id: currentTask.session_id,
              job_id: currentTask.id,
            },
            error,
          );
          continue;
        }

        const agent = getAgent(currentTask.runtime_id, currentTask.agent_id);
        if (!agent) {
          const error = `Agent not found: ${currentTask.agent_id}`;
          logger.error(
            {
              runtime_id: currentTask.runtime_id,
              agent_id: currentTask.agent_id,
              session_id: currentTask.session_id,
              task_id: currentTask.id,
              error,
            },
            'Task agent unavailable',
          );
          pauseInvalidTask(
            currentTask.id,
            {
              runtime_id: currentTask.runtime_id,
              agent_id: currentTask.agent_id,
              session_id: currentTask.session_id,
              job_id: currentTask.id,
            },
            error,
          );
          continue;
        }

        submitScheduledTaskJob(currentTask);
      }
    } catch (err) {
      logger.error({ err }, 'Error in scheduler loop');
    }

    setTimeout(loop, SCHEDULER_POLL_INTERVAL);
  };

  void loop();
}

export function _resetSchedulerLoopForTests(): void {
  schedulerRunning = false;
}
