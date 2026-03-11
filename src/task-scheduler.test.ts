import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  _initTestDatabase,
  ensureSession,
  getAllSchedules,
  createSchedule,
  getScheduleById,
  updateSchedule,
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

  it('lists schedules from database', () => {
    ensureSession({
      agent_id: 'agent-1',
      session_id: 'session-1',
      channel: 'test',
      agent_name: 'Agent 1',
    });

    const schedules = getAllSchedules();
    expect(Array.isArray(schedules)).toBe(true);
  });
});
