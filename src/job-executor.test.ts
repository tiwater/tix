import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./run-agent.js', async () => {
  const actual =
    await vi.importActual<typeof import('./run-agent.js')>('./run-agent.js');
  return {
    ...actual,
    appendJobLog: vi.fn(),
    getJobLogPath: vi.fn(() => '/tmp/ticlaw-job-test.jsonl'),
    runAgent: vi.fn(),
  };
});

import {
  _initTestDatabase,
  createJob,
  ensureSession,
  getJobById,
  transitionJobStatus,
} from './core/db.js';
import {
  _resetJobExecutorForTests,
  startJobExecutor,
  stopJobExecutor,
  submitJob,
} from './job-executor.js';
import { runAgent } from './run-agent.js';

function createSession() {
  return ensureSession({
    runtime_id: 'runtime-1',
    agent_id: 'agent-1',
    session_id: 'session-1',
    chat_jid: 'web:runtime-1:agent-1:session-1',
    channel: 'http',
    agent_name: 'Agent 1',
    agent_folder: 'agent_1',
  });
}

describe('job executor', () => {
  beforeEach(() => {
    _initTestDatabase();
    _resetJobExecutorForTests();
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    stopJobExecutor();
    vi.useRealTimers();
  });

  it('reuses the same idempotency key without duplicating execution', () => {
    createSession();

    const first = submitJob({
      runtime_id: 'runtime-1',
      agent_id: 'agent-1',
      session_id: 'session-1',
      chat_jid: 'web:runtime-1:agent-1:session-1',
      prompt: 'first prompt',
      source: 'api',
      submitted_by: 'tester',
      submitter_type: 'api_key',
      idempotency_key: 'same-key',
    });
    const second = submitJob({
      runtime_id: 'runtime-1',
      agent_id: 'agent-1',
      session_id: 'session-1',
      chat_jid: 'web:runtime-1:agent-1:session-1',
      prompt: 'second prompt',
      source: 'api',
      submitted_by: 'tester',
      submitter_type: 'api_key',
      idempotency_key: 'same-key',
    });

    expect(second.id).toBe(first.id);
    expect(getJobById(first.id)?.prompt).toBe('first prompt');
  });

  it('recovers a running job on restart and drives it to completion', async () => {
    createSession();
    const created = createJob({
      runtime_id: 'runtime-1',
      agent_id: 'agent-1',
      session_id: 'session-1',
      chat_jid: 'web:runtime-1:agent-1:session-1',
      prompt: 'recover me',
      source: 'api',
      submitted_by: 'tester',
      submitter_type: 'api_key',
      timeout_ms: 60_000,
      step_timeout_ms: 60_000,
      max_retries: 0,
      retry_backoff_ms: 1000,
    });
    transitionJobStatus(created.id, 'running', {
      attempt_count: 1,
      started_at: '2026-03-10T00:00:00.000Z',
      last_activity_at: '2026-03-10T00:00:01.000Z',
    });

    vi.mocked(runAgent).mockImplementation(async ({ onReply }) => {
      await onReply('recovered');
    });

    startJobExecutor({
      registeredProjects: () => ({}),
      sendMessage: async () => {},
    });

    await vi.advanceTimersByTimeAsync(50);

    expect(getJobById(created.id)?.status).toBe('succeeded');
    expect(getJobById(created.id)?.result?.text).toBe('recovered');
    expect(vi.mocked(runAgent)).toHaveBeenCalledTimes(1);
  });

  it('records timeout failures with machine-parseable codes', async () => {
    createSession();
    const created = submitJob({
      runtime_id: 'runtime-1',
      agent_id: 'agent-1',
      session_id: 'session-1',
      chat_jid: 'web:runtime-1:agent-1:session-1',
      prompt: 'stall forever',
      source: 'api',
      submitted_by: 'tester',
      submitter_type: 'api_key',
      timeout_ms: 100,
      step_timeout_ms: 100,
      max_retries: 0,
      retry_backoff_ms: 50,
    });

    vi.mocked(runAgent).mockImplementation(
      ({ signal }) =>
        new Promise<void>((resolve, reject) => {
          signal?.addEventListener('abort', () => {
            reject(
              signal.reason instanceof Error
                ? signal.reason
                : new Error('aborted'),
            );
          });
        }),
    );

    startJobExecutor({
      registeredProjects: () => ({}),
      sendMessage: async () => {},
    });

    await vi.advanceTimersByTimeAsync(250);

    const timedOut = getJobById(created.id);
    expect(timedOut?.status).toBe('timeout');
    expect(timedOut?.error?.code).toBe('job_timeout');
    expect(timedOut?.error?.classification).toBe('internal_error');
  });
});
