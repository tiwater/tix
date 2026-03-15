/**
 * Schedule executor — polls the schedules table and submits tasks.
 */
import fs from 'fs';
import path from 'path';
import { CronExpressionParser } from 'cron-parser';

import {
  getAgent,
  getDueSchedules,
  getScheduleById,
  updateSchedule,
  updateScheduleAfterRun,
  deleteSchedule,
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
let timeoutId: NodeJS.Timeout | null = null;
let loopRef: (() => Promise<void>) | null = null;

export function forceSchedulerCheck(): void {
  logger.info('Manually triggering scheduler check');
  if (timeoutId) clearTimeout(timeoutId);
  if (loopRef) void loopRef();
}

export function startSchedulerLoop(_deps: SchedulerDependencies): void {
  if (schedulerRunning) {
    logger.debug('Scheduler loop already running, skipping duplicate start');
    return;
  }
  schedulerRunning = true;
  logger.info('Scheduler loop started');

  loopRef = async () => {
    try {
      const dueSchedules = getDueSchedules();
      if (dueSchedules.length > 0) {
        logger.info({ count: dueSchedules.length }, 'Found due schedules');
      }

      for (const schedule of dueSchedules) {
        const current = getScheduleById(schedule.id);
        if (!current || current.status !== 'active') continue;

        if (!current.agent_id) {
          logger.warn(
            { schedule_id: current.id },
            'Schedule missing agent_id, skipping',
          );
          continue;
        }

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

        // Compute next run time or delete
        if (current.delete_after_run) {
          logger.info(
            { schedule_id: current.id },
            'Deleting one-shot schedule after run',
          );
          deleteSchedule(current.id);
        } else {
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
      }
    } catch (err) {
      logger.error({ err }, 'Error in scheduler loop');
    }

    timeoutId = setTimeout(loopRef, SCHEDULER_POLL_INTERVAL);
  };

  void loopRef();
}

export function _resetSchedulerLoopForTests(): void {
  schedulerRunning = false;
  if (timeoutId) clearTimeout(timeoutId);
  timeoutId = null;
  loopRef = null;
}
