import { CronExpressionParser } from 'cron-parser';
import fs from 'fs';

import {
  AGENT_CONCURRENCY_LIMIT,
  RUNTIME_CONCURRENCY_LIMIT,
  SESSION_CONCURRENCY_LIMIT,
  SCHEDULER_POLL_INTERVAL,
  TIMEZONE,
} from './core/config.js';
import {
  getAgent,
  getDueTasks,
  getSessionByScope,
  getTaskById,
  logTaskRun,
  updateTask,
  updateTaskAfterRun,
} from './core/db.js';
import { logger } from './core/logger.js';
import { RegisteredProject, ScheduledTask } from './core/types.js';
import { runAgent } from './run-agent.js';

export interface SchedulerDependencies {
  registeredProjects: () => Record<string, RegisteredProject>;
  sendMessage: (jid: string, text: string) => Promise<void>;
}

interface ActiveJobScope {
  runtime_id: string;
  agent_id: string;
  session_id: string;
  job_id: string;
}

const activeJobs = new Map<string, ActiveJobScope>();

function countActiveJobs(
  predicate: (scope: ActiveJobScope) => boolean,
): number {
  let count = 0;
  for (const scope of activeJobs.values()) {
    if (predicate(scope)) count += 1;
  }
  return count;
}

function canRunTask(task: ScheduledTask): {
  allowed: boolean;
  runtimeActive: number;
  agentActive: number;
  sessionActive: number;
} {
  const runtimeActive = countActiveJobs(
    (scope) => scope.runtime_id === task.runtime_id,
  );
  const agentActive = countActiveJobs(
    (scope) =>
      scope.runtime_id === task.runtime_id && scope.agent_id === task.agent_id,
  );
  const sessionActive = countActiveJobs(
    (scope) =>
      scope.runtime_id === task.runtime_id &&
      scope.agent_id === task.agent_id &&
      scope.session_id === task.session_id,
  );

  return {
    allowed:
      runtimeActive < RUNTIME_CONCURRENCY_LIMIT &&
      agentActive < AGENT_CONCURRENCY_LIMIT &&
      sessionActive < SESSION_CONCURRENCY_LIMIT,
    runtimeActive,
    agentActive,
    sessionActive,
  };
}

async function runTask(
  task: ScheduledTask,
  deps: SchedulerDependencies,
): Promise<void> {
  const startTime = Date.now();
  const log = logger.child({
    runtime_id: task.runtime_id,
    agent_id: task.agent_id,
    session_id: task.session_id,
    job_id: task.id,
  });
  const session = getSessionByScope(
    task.runtime_id,
    task.agent_id,
    task.session_id,
  );

  if (!session || session.status !== 'active') {
    const error = session
      ? 'Session is not active'
      : 'Session not found for scheduled task';
    updateTask(task.id, { status: 'paused' });
    log.error({ chat_jid: task.chat_jid, error }, 'Task session unavailable');
    logTaskRun({
      runtime_id: task.runtime_id,
      agent_id: task.agent_id,
      session_id: task.session_id,
      job_id: task.id,
      task_id: task.id,
      run_at: new Date().toISOString(),
      duration_ms: Date.now() - startTime,
      status: 'error',
      result: null,
      error,
    });
    return;
  }

  fs.mkdirSync(session.workspace_path, { recursive: true });
  fs.mkdirSync(session.logs_path, { recursive: true });

  const groups = deps.registeredProjects();
  const group =
    Object.values(groups).find(
      (candidate) =>
        (candidate.runtime_id || task.runtime_id) === task.runtime_id &&
        (candidate.agent_id || candidate.folder) === task.agent_id,
    ) ||
    (() => {
      const agent = getAgent(task.runtime_id, task.agent_id);
      if (!agent) return undefined;
      return {
        name: agent.name,
        folder: agent.folder,
        runtime_id: agent.runtime_id,
        agent_id: agent.agent_id,
        trigger: '',
        added_at: session.created_at,
        requiresTrigger: false,
        isMain: false,
      } satisfies RegisteredProject;
    })();

  if (!group) {
    const error = `Agent not found: ${task.agent_id}`;
    updateTask(task.id, { status: 'paused' });
    log.error({ error }, 'Task agent unavailable');
    logTaskRun({
      runtime_id: task.runtime_id,
      agent_id: task.agent_id,
      session_id: task.session_id,
      job_id: task.id,
      task_id: task.id,
      run_at: new Date().toISOString(),
      duration_ms: Date.now() - startTime,
      status: 'error',
      result: null,
      error,
    });
    return;
  }

  let result: string | null = null;
  let error: string | null = null;

  try {
    log.info({ chat_jid: session.chat_jid }, 'Running scheduled task');
    await runAgent({
      group,
      session: {
        ...session,
        job_id: task.id,
      },
      messages: [
        {
          role: 'user',
          content: `[CRON TASK TRIGGERED]\n${task.prompt}`,
        },
      ],
      onReply: async (text) => {
        result = text;
        await deps.sendMessage(session.chat_jid, text);
      },
    });
    log.info({ duration_ms: Date.now() - startTime }, 'Task completed');
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
    log.error({ error }, 'Task failed');
  }

  const durationMs = Date.now() - startTime;

  logTaskRun({
    runtime_id: task.runtime_id,
    agent_id: task.agent_id,
    session_id: task.session_id,
    job_id: task.id,
    task_id: task.id,
    run_at: new Date().toISOString(),
    duration_ms: durationMs,
    status: error ? 'error' : 'success',
    result,
    error,
  });

  let nextRun: string | null = null;
  if (task.schedule_type === 'cron') {
    const interval = CronExpressionParser.parse(task.schedule_value, {
      tz: TIMEZONE,
    });
    nextRun = interval.next().toISOString();
  } else if (task.schedule_type === 'interval') {
    const ms = parseInt(task.schedule_value, 10);
    nextRun = new Date(Date.now() + ms).toISOString();
  }

  const resultSummary = error
    ? `Error: ${error}`
    : result
      ? result.slice(0, 200)
      : 'Completed';
  updateTaskAfterRun(task.id, nextRun, resultSummary);
}

let schedulerRunning = false;

export function startSchedulerLoop(deps: SchedulerDependencies): void {
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
        if (activeJobs.has(currentTask.id)) continue;

        const capacity = canRunTask(currentTask);
        if (!capacity.allowed) {
          logger.debug(
            {
              runtime_id: currentTask.runtime_id,
              agent_id: currentTask.agent_id,
              session_id: currentTask.session_id,
              job_id: currentTask.id,
              runtime_active: capacity.runtimeActive,
              agent_active: capacity.agentActive,
              session_active: capacity.sessionActive,
            },
            'Concurrency limit reached, deferring scheduled task',
          );
          continue;
        }

        activeJobs.set(currentTask.id, {
          runtime_id: currentTask.runtime_id,
          agent_id: currentTask.agent_id,
          session_id: currentTask.session_id,
          job_id: currentTask.id,
        });

        void runTask(currentTask, deps).finally(() => {
          activeJobs.delete(currentTask.id);
        });
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
  activeJobs.clear();
}
