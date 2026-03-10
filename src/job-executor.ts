import os from 'os';

import { CronExpressionParser } from 'cron-parser';

import {
  AGENT_CONCURRENCY_LIMIT,
  JOB_DEFAULT_RETRY_BACKOFF_MS,
  JOB_DEFAULT_RETRY_COUNT,
  JOB_DEFAULT_STEP_TIMEOUT_MS,
  JOB_DEFAULT_TIMEOUT_MS,
  RUNTIME_CAPABILITY_WHITELIST,
  RUNTIME_CONCURRENCY_LIMIT,
  SESSION_CONCURRENCY_LIMIT,
  TIMEZONE,
} from './core/config.js';
import {
  appendAuditLog,
  createJob,
  getAgent,
  getJobById,
  getJobByIdempotencyKey,
  getRecoverableJobs,
  getRunnableJobs,
  getRuntime,
  getSessionByScope,
  getTaskById,
  logTaskRun,
  transitionJobStatus,
  updateJobFields,
  updateTask,
  updateTaskAfterRun,
  upsertRuntimeRegistration,
} from './core/db.js';
import { logger } from './core/logger.js';
import { appendJobLog, runAgent } from './run-agent.js';
import type {
  CreateJobInput,
  JobErrorInfo,
  JobFailureClassification,
  JobRecord,
  JobStatus,
  RegisteredProject,
  ScheduledTask,
  SessionContext,
} from './core/types.js';

export interface JobExecutorDependencies {
  registeredProjects: () => Record<string, RegisteredProject>;
  sendMessage: (jid: string, text: string) => Promise<void>;
}

class JobExecutionError extends Error {
  classification: JobFailureClassification;
  code: string;
  details?: Record<string, unknown>;

  constructor(
    classification: JobFailureClassification,
    code: string,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'JobExecutionError';
    this.classification = classification;
    this.code = code;
    this.details = details;
  }
}

interface ActiveExecution {
  job: JobRecord;
  controller: AbortController;
  lastActivityMs: number;
  lastPersistMs: number;
}

const MACHINE_HOSTNAME = os.hostname();
const QUEUE_POLL_INTERVAL_MS = 1_000;

let executorDeps: JobExecutorDependencies | null = null;
let executorStarted = false;
let queueTimer: NodeJS.Timeout | null = null;
let pumpInFlight = false;
const activeExecutions = new Map<string, ActiveExecution>();

function schedulePump(delayMs = QUEUE_POLL_INTERVAL_MS): void {
  if (!executorStarted) return;
  if (queueTimer) clearTimeout(queueTimer);
  queueTimer = setTimeout(() => {
    void pumpQueue();
  }, delayMs);
}

function countActiveJobs(predicate: (job: JobRecord) => boolean): number {
  let count = 0;
  for (const active of activeExecutions.values()) {
    if (predicate(active.job)) count += 1;
  }
  return count;
}

function canRunJob(job: JobRecord): boolean {
  const runtimeActive = countActiveJobs(
    (candidate) => candidate.runtime_id === job.runtime_id,
  );
  const agentActive = countActiveJobs(
    (candidate) =>
      candidate.runtime_id === job.runtime_id &&
      candidate.agent_id === job.agent_id,
  );
  const sessionActive = countActiveJobs(
    (candidate) =>
      candidate.runtime_id === job.runtime_id &&
      candidate.agent_id === job.agent_id &&
      candidate.session_id === job.session_id,
  );

  return (
    runtimeActive < RUNTIME_CONCURRENCY_LIMIT &&
    agentActive < AGENT_CONCURRENCY_LIMIT &&
    sessionActive < SESSION_CONCURRENCY_LIMIT
  );
}

function refreshRuntimeCapacity(runtimeId: string): void {
  const busySlots = countActiveJobs((job) => job.runtime_id === runtimeId);
  upsertRuntimeRegistration({
    runtime_id: runtimeId,
    busy_slots: busySlots,
    total_slots: RUNTIME_CONCURRENCY_LIMIT,
    last_heartbeat_at: new Date().toISOString(),
  });
}

function resolveGroupForJob(
  job: JobRecord,
  deps: JobExecutorDependencies,
  session: SessionContext,
): RegisteredProject {
  const groups = deps.registeredProjects();
  const registered =
    Object.values(groups).find(
      (candidate) =>
        (candidate.runtime_id || job.runtime_id) === job.runtime_id &&
        (candidate.agent_id || candidate.folder) === job.agent_id,
    ) || null;
  if (registered) return registered;

  const agent = getAgent(job.runtime_id, job.agent_id);
  if (!agent) {
    throw new JobExecutionError(
      'env_error',
      'agent_not_found',
      `Agent not found: ${job.agent_id}`,
    );
  }

  return {
    name: agent.name,
    folder: agent.folder,
    runtime_id: agent.runtime_id,
    agent_id: agent.agent_id,
    trigger: '',
    added_at: session.created_at,
    requiresTrigger: false,
    isMain: false,
  };
}

function validateCapabilities(job: JobRecord): void {
  if (job.required_capabilities.length === 0) return;

  const runtime = getRuntime(job.runtime_id);
  const runtimeCapabilities = new Set(runtime?.capabilities || []);
  const configuredWhitelist = RUNTIME_CAPABILITY_WHITELIST.length
    ? new Set(RUNTIME_CAPABILITY_WHITELIST)
    : new Set(runtime?.capability_whitelist || []);

  const disallowed = job.required_capabilities.filter(
    (capability) =>
      configuredWhitelist.size > 0 && !configuredWhitelist.has(capability),
  );
  if (disallowed.length > 0) {
    throw new JobExecutionError(
      'permission_error',
      'capability_not_allowed',
      `Capabilities not allowed: ${disallowed.join(', ')}`,
      { disallowed },
    );
  }

  const missing = job.required_capabilities.filter(
    (capability) => !runtimeCapabilities.has(capability),
  );
  if (missing.length > 0) {
    throw new JobExecutionError(
      'permission_error',
      'capability_unavailable',
      `Capabilities unavailable on runtime ${job.runtime_id}: ${missing.join(', ')}`,
      { missing },
    );
  }
}

function classifyError(err: unknown): JobErrorInfo {
  if (err instanceof JobExecutionError) {
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
    lower.includes('malformed') ||
    lower.includes('bad request')
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
    lower.includes('command not found') ||
    lower.includes('module not found') ||
    lower.includes('not installed')
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
    lower.includes('non-zero') ||
    lower.includes('command failed')
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
  job: JobRecord,
  status: JobStatus,
  error: JobErrorInfo,
): boolean {
  if (status !== 'failed' && status !== 'timeout') return false;
  if (job.attempt_count > job.max_retries) return false;
  if (
    error.classification === 'input_error' ||
    error.classification === 'permission_error'
  ) {
    return false;
  }
  return true;
}

function getRetryDelayMs(job: JobRecord): number {
  const base = job.retry_backoff_ms || JOB_DEFAULT_RETRY_BACKOFF_MS;
  const exponent = Math.max(job.attempt_count - 1, 0);
  return base * Math.pow(2, exponent);
}

function buildJobPrompt(job: JobRecord): string {
  if (job.source === 'scheduled_task') {
    return `[CRON TASK TRIGGERED]\n${job.prompt}`;
  }
  return job.prompt;
}

function updateActivity(
  active: ActiveExecution,
  session: SessionContext,
): void {
  const now = Date.now();
  active.lastActivityMs = now;
  if (now - active.lastPersistMs < 2_000) return;
  active.lastPersistMs = now;
  updateJobFields(active.job.id, {
    last_activity_at: new Date(now).toISOString(),
  });
  appendJobLog(session, {
    phase: 'activity',
    elapsed_ms:
      now - Date.parse(active.job.started_at || active.job.created_at),
  });
}

function normalizeAbort(
  signal: AbortSignal,
): { status: JobStatus; error: JobErrorInfo } | null {
  if (!signal.aborted) return null;
  if (signal.reason && typeof signal.reason === 'object') {
    const reason = signal.reason as {
      status?: JobStatus;
      error?: JobErrorInfo;
    };
    if (reason.status && reason.error) return reason as any;
  }
  return {
    status: 'canceled',
    error: {
      classification: 'internal_error',
      code: 'job_canceled',
      message: 'Job canceled',
    },
  };
}

async function finalizeScheduledTaskRun(
  job: JobRecord,
  finalStatus: JobStatus,
  resultText: string | undefined,
  errorInfo: JobErrorInfo | undefined,
): Promise<void> {
  if (job.source !== 'scheduled_task' || !job.source_ref) return;
  const task = getTaskById(job.source_ref);
  if (!task) return;

  const durationMs =
    (job.finished_at ? Date.parse(job.finished_at) : Date.now()) -
    (job.started_at ? Date.parse(job.started_at) : Date.parse(job.created_at));
  const resultSummary = errorInfo
    ? `Error: ${errorInfo.message}`
    : resultText
      ? resultText.slice(0, 200)
      : 'Completed';

  if (
    errorInfo &&
    ['session_unavailable', 'agent_not_found'].includes(errorInfo.code)
  ) {
    updateTask(task.id, { status: 'paused', next_run: null });
  } else {
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
    updateTaskAfterRun(task.id, nextRun, resultSummary);
  }

  logTaskRun({
    runtime_id: job.runtime_id,
    agent_id: job.agent_id,
    session_id: job.session_id,
    job_id: job.id,
    task_id: task.id,
    run_at: job.started_at || new Date().toISOString(),
    duration_ms: Math.max(durationMs, 0),
    status: finalStatus === 'succeeded' ? 'success' : 'error',
    result: resultText || null,
    error: errorInfo?.message || null,
  });
}

async function executeJob(jobId: string): Promise<void> {
  const deps = executorDeps;
  if (!deps) return;

  const queuedJob = getJobById(jobId);
  if (
    !queuedJob ||
    queuedJob.status !== 'queued' ||
    activeExecutions.has(jobId)
  ) {
    return;
  }

  const startedAt = new Date().toISOString();
  const runningJob = transitionJobStatus(jobId, 'running', {
    attempt_count: queuedJob.attempt_count + 1,
    started_at: queuedJob.started_at || startedAt,
    last_activity_at: startedAt,
    cancel_requested_at: queuedJob.cancel_requested_at || null,
    finished_at: null,
  });
  const sessionRecord = getSessionByScope(
    runningJob.runtime_id,
    runningJob.agent_id,
    runningJob.session_id,
  );
  const jobLogSession = sessionRecord
    ? ({ ...sessionRecord, job_id: runningJob.id } as SessionContext)
    : null;

  appendAuditLog({
    job_id: runningJob.id,
    runtime_id: runningJob.runtime_id,
    agent_id: runningJob.agent_id,
    session_id: runningJob.session_id,
    actor_type: 'system',
    actor_id: 'job-executor',
    action: 'job_started',
    result: runningJob.status,
    machine_hostname: MACHINE_HOSTNAME,
    details: { attempt_count: runningJob.attempt_count },
  });
  if (jobLogSession) {
    appendJobLog(jobLogSession, {
      phase: 'running',
      attempt_count: runningJob.attempt_count,
    });
  }

  const controller = new AbortController();
  const active: ActiveExecution = {
    job: runningJob,
    controller,
    lastActivityMs: Date.now(),
    lastPersistMs: 0,
  };
  activeExecutions.set(runningJob.id, active);
  refreshRuntimeCapacity(runningJob.runtime_id);

  let hardTimeout: NodeJS.Timeout | null = null;
  let stepTimeout: NodeJS.Timeout | null = null;
  let resultText: string | undefined;

  try {
    if (!sessionRecord || sessionRecord.status !== 'active') {
      throw new JobExecutionError(
        'env_error',
        'session_unavailable',
        'Session unavailable for job execution',
      );
    }
    const session = {
      ...sessionRecord,
      job_id: runningJob.id,
    } as SessionContext;

    validateCapabilities(runningJob);
    const group = resolveGroupForJob(runningJob, deps, session);

    hardTimeout = setTimeout(() => {
      controller.abort({
        status: 'timeout',
        error: {
          classification: 'internal_error',
          code: 'job_timeout',
          message: `Job exceeded timeout of ${runningJob.timeout_ms}ms`,
        },
      });
    }, runningJob.timeout_ms || JOB_DEFAULT_TIMEOUT_MS);

    if (runningJob.step_timeout_ms) {
      stepTimeout = setInterval(
        () => {
          if (
            Date.now() - active.lastActivityMs <
            runningJob.step_timeout_ms!
          ) {
            return;
          }
          controller.abort({
            status: 'timeout',
            error: {
              classification: 'internal_error',
              code: 'step_timeout',
              message: `Job exceeded inactivity timeout of ${runningJob.step_timeout_ms}ms`,
            },
          });
        },
        Math.min(runningJob.step_timeout_ms, 1_000),
      );
    }

    await runAgent({
      group,
      session,
      signal: controller.signal,
      messages: [{ role: 'user', content: buildJobPrompt(runningJob) }],
      onEvent: async () => updateActivity(active, session),
      onReply: async (text) => {
        resultText = text;
        await deps.sendMessage(session.chat_jid, text);
      },
    });

    const finishedAt = new Date().toISOString();
    const succeededJob = transitionJobStatus(runningJob.id, 'succeeded', {
      result: { text: resultText || '(done)' },
      error: null,
      finished_at: finishedAt,
      last_activity_at: finishedAt,
      cancel_requested_at: null,
      canceled_by: null,
    });
    appendAuditLog({
      job_id: succeededJob.id,
      runtime_id: succeededJob.runtime_id,
      agent_id: succeededJob.agent_id,
      session_id: succeededJob.session_id,
      actor_type: 'system',
      actor_id: 'job-executor',
      action: 'job_completed',
      result: succeededJob.status,
      machine_hostname: MACHINE_HOSTNAME,
    });
    if (jobLogSession) {
      appendJobLog(jobLogSession, {
        phase: 'succeeded',
        result: resultText || '(done)',
      });
    }
    await finalizeScheduledTaskRun(
      succeededJob,
      succeededJob.status,
      resultText,
      undefined,
    );
  } catch (err) {
    const aborted = normalizeAbort(controller.signal);
    const finalStatus = aborted?.status || 'failed';
    const errorInfo = aborted?.error || classifyError(err);

    if (shouldRetry(runningJob, finalStatus, errorInfo)) {
      const nextAttemptAt = new Date(
        Date.now() + getRetryDelayMs(runningJob),
      ).toISOString();
      const queuedRetry = transitionJobStatus(runningJob.id, 'queued', {
        error: errorInfo,
        next_attempt_at: nextAttemptAt,
        last_activity_at: new Date().toISOString(),
        cancel_requested_at: null,
      });
      appendAuditLog({
        job_id: queuedRetry.id,
        runtime_id: queuedRetry.runtime_id,
        agent_id: queuedRetry.agent_id,
        session_id: queuedRetry.session_id,
        actor_type: 'system',
        actor_id: 'job-executor',
        action: 'job_retry_scheduled',
        result: queuedRetry.status,
        machine_hostname: MACHINE_HOSTNAME,
        details: {
          attempt_count: queuedRetry.attempt_count,
          next_attempt_at: queuedRetry.next_attempt_at,
          error: errorInfo,
        },
      });
      if (jobLogSession) {
        appendJobLog(jobLogSession, {
          phase: 'retry_scheduled',
          attempt_count: queuedRetry.attempt_count,
          next_attempt_at: queuedRetry.next_attempt_at,
          error: errorInfo,
        });
      }
      return;
    }

    const finishedAt = new Date().toISOString();
    const finalJob = transitionJobStatus(runningJob.id, finalStatus, {
      error: errorInfo,
      result: resultText ? { text: resultText } : null,
      finished_at: finishedAt,
      last_activity_at: finishedAt,
    });
    appendAuditLog({
      job_id: finalJob.id,
      runtime_id: finalJob.runtime_id,
      agent_id: finalJob.agent_id,
      session_id: finalJob.session_id,
      actor_type: 'system',
      actor_id: 'job-executor',
      action: `job_${finalJob.status}`,
      result: finalJob.status,
      machine_hostname: MACHINE_HOSTNAME,
      details: { error: errorInfo },
    });
    if (jobLogSession) {
      appendJobLog(jobLogSession, {
        phase: finalJob.status,
        error: errorInfo,
      });
    }
    await finalizeScheduledTaskRun(
      finalJob,
      finalJob.status,
      resultText,
      errorInfo,
    );
  } finally {
    if (hardTimeout) clearTimeout(hardTimeout);
    if (stepTimeout) clearInterval(stepTimeout);
    activeExecutions.delete(runningJob.id);
    refreshRuntimeCapacity(runningJob.runtime_id);
    schedulePump(0);
  }
}

async function pumpQueue(): Promise<void> {
  if (pumpInFlight || !executorDeps) return;
  pumpInFlight = true;

  try {
    const queuedJobs = getRunnableJobs(100);
    for (const job of queuedJobs) {
      if (activeExecutions.has(job.id)) continue;
      if (!canRunJob(job)) continue;
      void executeJob(job.id);
    }
  } catch (err) {
    logger.error({ err }, 'job executor pump failed');
  } finally {
    pumpInFlight = false;
    schedulePump();
  }
}

function recoverJobs(): void {
  const recoverableJobs = getRecoverableJobs();
  const now = new Date().toISOString();

  for (const job of recoverableJobs) {
    if (job.status === 'running') {
      const recovered = transitionJobStatus(job.id, 'queued', {
        next_attempt_at: now,
        last_activity_at: now,
      });
      appendAuditLog({
        job_id: recovered.id,
        runtime_id: recovered.runtime_id,
        agent_id: recovered.agent_id,
        session_id: recovered.session_id,
        actor_type: 'system',
        actor_id: 'job-executor',
        action: 'job_recovered',
        result: recovered.status,
        machine_hostname: MACHINE_HOSTNAME,
        details: { previous_status: 'running' },
      });
    }
  }
}

export function startJobExecutor(deps: JobExecutorDependencies): void {
  executorDeps = deps;
  if (executorStarted) {
    logger.debug('job executor already started, skipping duplicate start');
    return;
  }

  executorStarted = true;
  recoverJobs();
  schedulePump(0);
  logger.info('job executor started');
}

export function stopJobExecutor(): void {
  executorStarted = false;
  if (queueTimer) {
    clearTimeout(queueTimer);
    queueTimer = null;
  }
  activeExecutions.clear();
}

export function submitJob(input: CreateJobInput): JobRecord {
  if (input.idempotency_key) {
    const existing = getJobByIdempotencyKey(input.idempotency_key);
    if (existing) return existing;
  }

  const job = createJob({
    ...input,
    timeout_ms: input.timeout_ms ?? JOB_DEFAULT_TIMEOUT_MS,
    step_timeout_ms: input.step_timeout_ms ?? JOB_DEFAULT_STEP_TIMEOUT_MS,
    max_retries: input.max_retries ?? JOB_DEFAULT_RETRY_COUNT,
    retry_backoff_ms: input.retry_backoff_ms ?? JOB_DEFAULT_RETRY_BACKOFF_MS,
  });
  appendAuditLog({
    job_id: job.id,
    runtime_id: job.runtime_id,
    agent_id: job.agent_id,
    session_id: job.session_id,
    actor_type: job.submitter_type,
    actor_id: job.submitted_by,
    action: 'job_submitted',
    result: job.status,
    machine_hostname: MACHINE_HOSTNAME,
    details: {
      source: job.source,
      idempotency_key: job.idempotency_key,
      required_capabilities: job.required_capabilities,
    },
  });

  const session = getSessionByScope(
    job.runtime_id,
    job.agent_id,
    job.session_id,
  );
  if (session) {
    appendJobLog({ ...session, job_id: job.id }, { phase: 'queued' });
  }
  schedulePump(0);
  return job;
}

export function submitScheduledTaskJob(task: ScheduledTask): JobRecord {
  const scheduledFor = task.next_run || new Date().toISOString();
  const job = submitJob({
    runtime_id: task.runtime_id,
    agent_id: task.agent_id,
    session_id: task.session_id,
    chat_jid: task.chat_jid,
    prompt: task.prompt,
    source: 'scheduled_task',
    source_ref: task.id,
    submitted_by: 'scheduler',
    submitter_type: 'system',
    idempotency_key: `scheduled:${task.id}:${scheduledFor}`,
    metadata: {
      task_id: task.id,
      schedule_type: task.schedule_type,
      schedule_value: task.schedule_value,
      scheduled_for: scheduledFor,
    },
  });
  updateTask(task.id, { next_run: null });
  return job;
}

export function cancelJob(jobId: string, actorId: string): JobRecord {
  const job = getJobById(jobId);
  if (!job) {
    throw new JobExecutionError(
      'input_error',
      'job_not_found',
      'Job not found',
    );
  }

  if (job.status === 'queued') {
    const canceled = transitionJobStatus(job.id, 'canceled', {
      cancel_requested_at: new Date().toISOString(),
      canceled_by: actorId,
      finished_at: new Date().toISOString(),
      error: {
        classification: 'internal_error',
        code: 'job_canceled',
        message: 'Job canceled before execution',
      },
    });
    appendAuditLog({
      job_id: canceled.id,
      runtime_id: canceled.runtime_id,
      agent_id: canceled.agent_id,
      session_id: canceled.session_id,
      actor_type: 'api_key',
      actor_id: actorId,
      action: 'job_canceled',
      result: canceled.status,
      machine_hostname: MACHINE_HOSTNAME,
    });
    return canceled;
  }

  if (job.status !== 'running') return job;

  const updated = updateJobFields(job.id, {
    cancel_requested_at: new Date().toISOString(),
    canceled_by: actorId,
  });
  const active = activeExecutions.get(job.id);
  active?.controller.abort({
    status: 'canceled',
    error: {
      classification: 'internal_error',
      code: 'job_canceled',
      message: 'Job canceled by API request',
      details: { actor_id: actorId },
    },
  });
  appendAuditLog({
    job_id: updated.id,
    runtime_id: updated.runtime_id,
    agent_id: updated.agent_id,
    session_id: updated.session_id,
    actor_type: 'api_key',
    actor_id: actorId,
    action: 'job_cancel_requested',
    result: updated.status,
    machine_hostname: MACHINE_HOSTNAME,
  });
  return updated;
}

export function retryJob(jobId: string, actorId: string): JobRecord {
  const job = getJobById(jobId);
  if (!job) {
    throw new JobExecutionError(
      'input_error',
      'job_not_found',
      'Job not found',
    );
  }
  if (!['failed', 'canceled', 'timeout'].includes(job.status)) {
    throw new JobExecutionError(
      'input_error',
      'job_not_retryable',
      `Job ${job.id} is not in a retryable state`,
    );
  }

  const queued = transitionJobStatus(job.id, 'queued', {
    next_attempt_at: new Date().toISOString(),
    cancel_requested_at: null,
    canceled_by: null,
    error: null,
    result: null,
    finished_at: null,
  });
  appendAuditLog({
    job_id: queued.id,
    runtime_id: queued.runtime_id,
    agent_id: queued.agent_id,
    session_id: queued.session_id,
    actor_type: 'api_key',
    actor_id: actorId,
    action: 'job_requeued',
    result: queued.status,
    machine_hostname: MACHINE_HOSTNAME,
  });
  const session = getSessionByScope(
    queued.runtime_id,
    queued.agent_id,
    queued.session_id,
  );
  if (session) {
    appendJobLog({ ...session, job_id: queued.id }, { phase: 'queued' });
  }
  schedulePump(0);
  return queued;
}

export function getExecutorRuntimeStats(runtimeId: string): {
  busy_slots: number;
  total_slots: number;
} {
  return {
    busy_slots: countActiveJobs((job) => job.runtime_id === runtimeId),
    total_slots: RUNTIME_CONCURRENCY_LIMIT,
  };
}

export function _resetJobExecutorForTests(): void {
  stopJobExecutor();
  executorDeps = null;
  pumpInFlight = false;
}
