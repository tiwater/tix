/**
 * Schedule executor — polls the schedules table and submits tasks.
 */
import { CronExpressionParser } from 'cron-parser';

import {
  getAgent,
  getDueSchedules,
  getScheduleById,
  updateSchedule,
  updateScheduleAfterRun,
} from './core/store.js';
import { logger } from './core/logger.js';
import { SCHEDULER_POLL_INTERVAL, TIMEZONE } from './core/config.js';
import { submitScheduleTask } from './task-executor.js';
import type { RegisteredProject } from './core/types.js';

export interface SchedulerDependencies {
  registeredProjects: () => Record<string, RegisteredProject>;
  sendMessage: (jid: string, text: string) => Promise<void>;
}

let schedulerRunning = false;

export function startSchedulerLoop(_deps: SchedulerDependencies): void {
  if (schedulerRunning) {
    logger.debug('Scheduler loop already running, skipping duplicate start');
    return;
  }
  schedulerRunning = true;
  logger.info('Scheduler loop started');

  const loop = async () => {
    try {
      const dueSchedules = getDueSchedules();
      if (dueSchedules.length > 0) {
        logger.info({ count: dueSchedules.length }, 'Found due schedules');
      }

      for (const schedule of dueSchedules) {
        const current = getScheduleById(schedule.id);
        if (!current || current.status !== 'active') continue;

        const agent = getAgent(current.agent_id);
        if (!agent) {
          logger.error(
            { agent_id: current.agent_id, schedule_id: current.id },
            'Schedule agent not found, pausing',
          );
          updateSchedule(current.id, { status: 'paused', next_run: null });
          continue;
        }

        // Submit the task
        submitScheduleTask(current);

        // Compute next run time
        let nextRun: string | null = null;
        try {
          const interval = CronExpressionParser.parse(current.cron, {
            tz: TIMEZONE,
          });
          nextRun = interval.next().toISOString();
        } catch (err) {
          logger.error(
            { schedule_id: current.id, cron: current.cron, err },
            'Invalid cron expression, pausing schedule',
          );
        }
        updateScheduleAfterRun(current.id, nextRun);
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
