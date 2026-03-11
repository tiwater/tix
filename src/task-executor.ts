/**
 * Task executor — runs agent tasks with in-memory state tracking.
 * Tasks are NOT persisted in the database. Only sessions and messages
 * provide the execution history.
 */
import { CronExpressionParser } from 'cron-parser';

import {
  AGENT_CONCURRENCY_LIMIT,
  CONCURRENCY_LIMIT,
  SESSION_CONCURRENCY_LIMIT,
  TASK_DEFAULT_RETRY_BACKOFF_MS,
  TASK_DEFAULT_RETRY_COUNT,
  TASK_DEFAULT_STEP_TIMEOUT_MS,
  TASK_DEFAULT_TIMEOUT_MS,
  TIMEZONE,
  agentPaths,
} from './core/config.js';
import {
  ensureSession,
  getAgent,
  getSession,
  updateScheduleAfterRun,
  updateSchedule,
} from './core/db.js';
import { logger } from './core/logger.js';
import { appendJobLog, runAgent } from './run-agent.js';
import type {
  CreateTaskInput,
  TaskErrorInfo,
  TaskFailureClassification,
  TaskRecord,
  TaskStatus,
  RegisteredProject,
  ScheduleRecord,
  SessionContext,
} from './core/types.js';

export interface TaskExecutorDependencies {
  registeredProjects: () => Record<string, RegisteredProject>;
  sendMessage: (jid: string, text: string) => Promise<void>;
  publishTaskEvent?: (
    sessionId: string,
    event: Record<string, unknown>,
  ) => Promise<void> | void;
}

class TaskExecutionError extends Error {
  classification: TaskFailureClassification;
  code: string;
  details?: Record<string, unknown>;

  constructor(
    classification: TaskFailureClassification,
    code: string,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'TaskExecutionError';
    this.classification = classification;
    this.code = code;
    this.details = details;
  }
}

interface ActiveExecution {
  task: TaskRecord;
  controller: AbortController;
  lastActivityMs: number;
}

const QUEUE_POLL_INTERVAL_MS = 1_000;

let executorDeps: TaskExecutorDependencies | null = null;
let executorStarted = false;
let queueTimer: NodeJS.Timeout | null = null;
let pumpInFlight = false;

// In-memory task queue and active executions
const taskQueue = new Map<string, TaskRecord>();
const activeExecutions = new Map<string, ActiveExecution>();

function schedulePump(delayMs = QUEUE_POLL_INTERVAL_MS): void {
  if (!executorStarted) return;
  if (queueTimer) clearTimeout(queueTimer);
  queueTimer = setTimeout(() => {
    void pumpQueue();
  }, delayMs);
}

function countActiveTasks(predicate: (task: TaskRecord) => boolean): number {
  let count = 0;
  for (const active of activeExecutions.values()) {
    if (predicate(active.task)) count += 1;
  }
  return count;
}

function canRunTask(task: TaskRecord): boolean {
  const totalActive = activeExecutions.size;
  const agentActive = countActiveTasks(
    (candidate) => candidate.agent_id === task.agent_id,
  );
  const sessionActive = countActiveTasks(
    (candidate) =>
      candidate.agent_id === task.agent_id &&
      candidate.session_id === task.session_id,
  );

  return (
    totalActive < CONCURRENCY_LIMIT &&
    agentActive < AGENT_CONCURRENCY_LIMIT &&
    sessionActive < SESSION_CONCURRENCY_LIMIT
  );
}

function resolveGroupForTask(
  task: TaskRecord,
  deps: TaskExecutorDependencies,
): RegisteredProject {
  const groups = deps.registeredProjects();
  const registered =
    Object.values(groups).find(
      (candidate) => (candidate.agent_id || candidate.folder) === task.agent_id,
    ) || null;
  if (registered) return registered;

  const agent = getAgent(task.agent_id);
  if (!agent) {
    throw new TaskExecutionError(
      'env_error',
      'agent_not_found',
      `Agent not found: ${task.agent_id}`,
    );
  }

  return {
    name: agent.name,
    folder: agent.agent_id,
    agent_id: agent.agent_id,
    trigger: '',
    added_at: agent.created_at,
    requiresTrigger: false,
    isMain: false,
  };
}

function classifyError(err: unknown): TaskErrorInfo {
  if (err instanceof TaskExecutionError) {
    return {
      classification: err.classification,
      code: err.code,
      message: err.message,
      details: err.details,
    };
  }

  const message = err instanceof Error ? err.message : String(err);
  const lower = message.toLowerCase();
  if (
    lower.includes('permission') ||
    lower.includes('forbidden') ||
    lower.includes('unauthorized') ||
    lower.includes('eacces') ||
    lower.includes('eperm') ||
    lower.includes('denied')
  ) {
    return {
      classification: 'permission_error',
      code: 'permission_denied',
      message,
    };
  }
  if (
    lower.includes('invalid') ||
    lower.includes('missing') ||
    lower.includes('required') ||
    lower.includes('malformed')
  ) {
    return {
      classification: 'input_error',
      code: 'invalid_input',
      message,
    };
  }
  if (
    lower.includes('enoent') ||
    lower.includes('not found') ||
    lower.includes('command not found')
  ) {
    return {
      classification: 'env_error',
      code: 'environment_unavailable',
      message,
    };
  }
  if (
    lower.includes('tool') ||
    lower.includes('bash') ||
    lower.includes('non-zero')
  ) {
    return {
      classification: 'tool_error',
      code: 'tool_failed',
      message,
    };
  }
  return {
    classification: 'internal_error',
    code: 'internal_error',
    message,
  };
}

function shouldRetry(
  task: TaskRecord,
  status: TaskStatus,
  error: TaskErrorInfo,
): boolean {
  if (status !== 'failed' && status !== 'timeout') return false;
  if (task.attempt_count > task.max_retries) return false;
  if (
    error.classification === 'input_error' ||
    error.classification === 'permission_error'
  ) {
    return false;
  }
  return true;
}

function getRetryDelayMs(task: TaskRecord): number {
  const base = task.retry_backoff_ms || TASK_DEFAULT_RETRY_BACKOFF_MS;
  const exponent = Math.max(task.attempt_count - 1, 0);
  return base * Math.pow(2, exponent);
}

function buildTaskPrompt(task: TaskRecord): string {
  if (task.source === 'schedule') {
    return `[CRON TASK TRIGGERED]\n${task.prompt}`;
  }
  return task.prompt;
}

function normalizeAbort(
  signal: AbortSignal,
): { status: TaskStatus; error: TaskErrorInfo } | null {
  if (!signal.aborted) return null;
  if (signal.reason && typeof signal.reason === 'object') {
    const reason = signal.reason as {
      status?: TaskStatus;
      error?: TaskErrorInfo;
    };
    if (reason.status && reason.error) return reason as any;
  }
  return {
    status: 'canceled',
    error: {
      classification: 'internal_error',
      code: 'task_canceled',
      message: 'Task canceled',
    },
  };
}

async function finalizeScheduleRun(
  task: TaskRecord,
  _finalStatus: TaskStatus,
  errorInfo: TaskErrorInfo | undefined,
): Promise<void> {
  if (task.source !== 'schedule' || !task.source_ref) return;

  if (
    errorInfo &&
    ['session_unavailable', 'agent_not_found'].includes(errorInfo.code)
  ) {
    updateSchedule(task.source_ref, { status: 'paused', next_run: null });
  } else {
    // Compute next run time from cron
    let nextRun: string | null = null;
    try {
      // task.source_ref is the schedule ID; we'd need the cron expression
      // For now, the scheduler handles next_run computation
    } catch {
      // ignore
    }
    updateScheduleAfterRun(task.source_ref, nextRun);
  }
}

async function executeTask(taskId: string): Promise<void> {
  const deps = executorDeps;
  if (!deps) return;

  const task = taskQueue.get(taskId);
  if (!task || task.status !== 'queued' || activeExecutions.has(taskId)) {
    return;
  }

  // Transition to running
  task.status = 'running';
  task.attempt_count += 1;
  task.started_at = task.started_at || new Date().toISOString();

  const sessionRecord = getSession(task.session_id);
  if (!sessionRecord || sessionRecord.status !== 'active') {
    task.status = 'failed';
    task.error = {
      classification: 'env_error',
      code: 'session_unavailable',
      message: 'Session unavailable for task execution',
    };
    taskQueue.delete(taskId);
    await finalizeScheduleRun(task, 'failed', task.error);
    return;
  }

  const session: SessionContext = {
    ...sessionRecord,
    task_id: task.id,
  };

  const controller = new AbortController();
  const active: ActiveExecution = {
    task,
    controller,
    lastActivityMs: Date.now(),
  };
  activeExecutions.set(task.id, active);

  let hardTimeout: NodeJS.Timeout | null = null;
  let stepTimeout: NodeJS.Timeout | null = null;
  let resultText: string | undefined;

  try {
    const group = resolveGroupForTask(task, deps);

    const timeoutMs = task.timeout_ms || TASK_DEFAULT_TIMEOUT_MS;
    if (timeoutMs > 0) {
      hardTimeout = setTimeout(() => {
        controller.abort({
          status: 'timeout',
          error: {
            classification: 'internal_error',
            code: 'task_timeout',
            message: `Task exceeded timeout of ${timeoutMs}ms`,
          },
        });
      }, timeoutMs);
    }

    if (task.step_timeout_ms) {
      stepTimeout = setInterval(
        () => {
          if (Date.now() - active.lastActivityMs < task.step_timeout_ms!) {
            return;
          }
          controller.abort({
            status: 'timeout',
            error: {
              classification: 'internal_error',
              code: 'step_timeout',
              message: `Task exceeded inactivity timeout of ${task.step_timeout_ms}ms`,
            },
          });
        },
        Math.min(task.step_timeout_ms, 1_000),
      );
    }

    await runAgent({
      group,
      session,
      signal: controller.signal,
      messages: [{ role: 'user', content: buildTaskPrompt(task) }],
      onEvent: async (_event) => {
        active.lastActivityMs = Date.now();
        await deps.publishTaskEvent?.(session.session_id, {
          agent_id: session.agent_id,
          session_id: session.session_id,
          task_id: task.id,
          ..._event,
        });
      },
      onReply: async (text) => {
        resultText = text;
        // For schedule tasks, we might not want to send to a chat
        if (task.source !== 'schedule') {
          // Find the chat_jid from the registered project
          await deps.sendMessage(session.session_id, text);
        }
      },
    });

    // Success
    task.status = 'succeeded';
    task.result = { text: resultText || '(done)' };
    task.finished_at = new Date().toISOString();
    taskQueue.delete(task.id);

    logger.info(
      { task_id: task.id, agent_id: task.agent_id },
      'Task succeeded',
    );
    await finalizeScheduleRun(task, 'succeeded', undefined);
  } catch (err) {
    const aborted = normalizeAbort(controller.signal);
    const finalStatus = aborted?.status || 'failed';
    const errorInfo = aborted?.error || classifyError(err);

    if (shouldRetry(task, finalStatus, errorInfo)) {
      const nextAttemptAt = new Date(
        Date.now() + getRetryDelayMs(task),
      ).toISOString();
      task.status = 'queued';
      task.error = errorInfo;
      task.next_attempt_at = nextAttemptAt;
      logger.info(
        { task_id: task.id, attempt: task.attempt_count, nextAttemptAt },
        'Task retry scheduled',
      );
      return;
    }

    task.status = finalStatus;
    task.error = errorInfo;
    task.result = resultText ? { text: resultText } : undefined;
    task.finished_at = new Date().toISOString();
    taskQueue.delete(task.id);

    logger.error({ task_id: task.id, error: errorInfo }, `Task ${finalStatus}`);
    await finalizeScheduleRun(task, finalStatus, errorInfo);
  } finally {
    if (hardTimeout) clearTimeout(hardTimeout);
    if (stepTimeout) clearInterval(stepTimeout);
    activeExecutions.delete(task.id);
    schedulePump(0);
  }
}

async function pumpQueue(): Promise<void> {
  if (pumpInFlight || !executorDeps) return;
  pumpInFlight = true;

  try {
    const now = new Date().toISOString();
    for (const [id, task] of taskQueue) {
      if (task.status !== 'queued') continue;
      if (task.next_attempt_at > now) continue;
      if (activeExecutions.has(id)) continue;
      if (!canRunTask(task)) continue;
      void executeTask(id);
    }
  } catch (err) {
    logger.error({ err }, 'task executor pump failed');
  } finally {
    pumpInFlight = false;
    schedulePump();
  }
}

// ═══════════════════════════════════════════════════════════════
// Public API
// ═══════════════════════════════════════════════════════════════

export function startTaskExecutor(deps: TaskExecutorDependencies): void {
  executorDeps = deps;
  if (executorStarted) {
    logger.debug('task executor already started, skipping duplicate start');
    return;
  }

  executorStarted = true;
  schedulePump(0);
  logger.info('task executor started');
}

export function stopTaskExecutor(): void {
  executorStarted = false;
  if (queueTimer) {
    clearTimeout(queueTimer);
    queueTimer = null;
  }
  activeExecutions.clear();
  taskQueue.clear();
}

export function submitTask(input: CreateTaskInput): TaskRecord {
  const now = new Date().toISOString();
  const id = input.id || crypto.randomUUID();

  // Ensure session exists
  ensureSession({
    agent_id: input.agent_id,
    session_id: input.session_id,
    channel: input.source === 'schedule' ? 'schedule' : 'api',
    source_ref: input.source_ref,
    agent_name: input.agent_id,
  });

  const task: TaskRecord = {
    id,
    agent_id: input.agent_id,
    session_id: input.session_id,
    source: input.source,
    source_ref: input.source_ref,
    prompt: input.prompt,
    submitted_by: input.submitted_by,
    submitter_type: input.submitter_type,
    idempotency_key: input.idempotency_key,
    required_capabilities: input.required_capabilities || [],
    status: 'queued',
    timeout_ms: input.timeout_ms ?? TASK_DEFAULT_TIMEOUT_MS,
    step_timeout_ms: input.step_timeout_ms ?? TASK_DEFAULT_STEP_TIMEOUT_MS,
    max_retries: input.max_retries ?? TASK_DEFAULT_RETRY_COUNT,
    retry_backoff_ms: input.retry_backoff_ms ?? TASK_DEFAULT_RETRY_BACKOFF_MS,
    attempt_count: 0,
    next_attempt_at: now,
    metadata: input.metadata,
    created_at: now,
    updated_at: now,
  };

  taskQueue.set(id, task);
  schedulePump(0);
  return task;
}

export function submitScheduleTask(schedule: ScheduleRecord): TaskRecord {
  const sessionId = `sched-${schedule.id}-${Date.now()}`;
  return submitTask({
    agent_id: schedule.agent_id,
    session_id: sessionId,
    prompt: schedule.prompt,
    source: 'schedule',
    source_ref: schedule.id,
    submitted_by: 'scheduler',
    submitter_type: 'system',
    idempotency_key: `schedule:${schedule.id}:${schedule.next_run || Date.now()}`,
  });
}

export function cancelTask(taskId: string): TaskRecord | undefined {
  const task = taskQueue.get(taskId);
  if (!task) return undefined;

  if (task.status === 'queued') {
    task.status = 'canceled';
    task.finished_at = new Date().toISOString();
    taskQueue.delete(taskId);
    return task;
  }

  if (task.status === 'running') {
    const active = activeExecutions.get(taskId);
    active?.controller.abort({
      status: 'canceled',
      error: {
        classification: 'internal_error',
        code: 'task_canceled',
        message: 'Task canceled by request',
      },
    });
    return task;
  }

  return task;
}

export function getActiveTaskById(taskId: string): TaskRecord | undefined {
  return taskQueue.get(taskId);
}

export function listActiveTasks(): TaskRecord[] {
  return Array.from(taskQueue.values());
}

export function getExecutorStats(): {
  busy_slots: number;
  total_slots: number;
} {
  return {
    busy_slots: activeExecutions.size,
    total_slots: CONCURRENCY_LIMIT,
  };
}

export function _resetTaskExecutorForTests(): void {
  stopTaskExecutor();
  executorDeps = null;
  pumpInFlight = false;
}
