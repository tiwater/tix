import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  _initTestDatabase,
  createTask,
  ensureSession,
  getTaskById,
  updateSessionStatus,
} from './core/db.js';
import {
  _resetSchedulerLoopForTests,
  startSchedulerLoop,
} from './task-scheduler.js';

describe('task scheduler', () => {
  beforeEach(() => {
    _initTestDatabase();
    _resetSchedulerLoopForTests();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('pauses due tasks whose session is missing', async () => {
    ensureSession({
      runtime_id: 'runtime-1',
      agent_id: 'agent-1',
      session_id: 'session-missing',
      chat_jid: 'bad@g.us',
      channel: 'test',
      agent_name: 'Agent 1',
      agent_folder: 'agent_1',
    });
    updateSessionStatus(
      'runtime-1',
      'agent-1',
      'session-missing',
      'terminated',
    );

    createTask({
      id: 'task-missing-session',
      runtime_id: 'runtime-1',
      agent_id: 'agent-1',
      session_id: 'session-missing',
      chat_jid: 'bad@g.us',
      prompt: 'run',
      schedule_type: 'once',
      schedule_value: '2026-02-22T00:00:00.000Z',
      context_mode: 'isolated',
      next_run: new Date(Date.now() - 60_000).toISOString(),
      status: 'active',
      created_at: '2026-02-22T00:00:00.000Z',
    });

    startSchedulerLoop({
      registeredProjects: () => ({}),
      sendMessage: async () => {},
    });

    await vi.advanceTimersByTimeAsync(10);

    const task = getTaskById('task-missing-session');
    expect(task?.status).toBe('paused');
  });
});
