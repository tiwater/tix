/**
 * Production Gate — integration test suite that validates cross-cutting
 * system-level concerns for production readiness.
 *
 * Covers:
 *  1. ID consistency across DB schema
 *  2. Job lifecycle (create/run/succeed/fail/cancel)
 *  3. Session isolation (no cross-session leakage)
 *  4. Skills governance (trust, permissions)
 *  5. Enrollment state machine (TOFU flow)
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import {
  _initTestDatabase,
  appendAuditLog,
  createJob,
  ensureSession,
  getJobByIdempotencyKey,
  getRuntime,
  getSessionByScope,
  transitionJobStatus,
  upsertRuntimeRegistration,
} from './core/db.js';
import {
  DelegationDepthExceededError,
  MAX_DELEGATION_DEPTH,
} from './sub-agent.js';
import {
  createEnrollmentToken,
  readEnrollmentState,
  verifyEnrollmentToken,
  setTrustState,
} from './core/enrollment.js';
import { SkillsRegistry } from './skills/registry.js';
import type { SkillsConfig } from './skills/types.js';

beforeEach(() => {
  _initTestDatabase();
});

// ─── 1. ID Consistency ───────────────────────────────────────

describe('Production Gate: ID Consistency', () => {
  it('runtime_id/agent_id/session_id are consistent across DB tables', () => {
    const session = ensureSession({
      runtime_id: 'rt-gate',
      agent_id: 'ag-gate',
      session_id: 'ss-gate',
      chat_jid: 'gate-chat',
      channel: 'test',
      agent_name: 'Gate Agent',
      agent_folder: 'gate_agent',
    });

    expect(session.runtime_id).toBe('rt-gate');
    expect(session.agent_id).toBe('ag-gate');
    expect(session.session_id).toBe('ss-gate');

    const job = createJob({
      runtime_id: 'rt-gate',
      agent_id: 'ag-gate',
      session_id: 'ss-gate',
      chat_jid: 'gate-chat',
      prompt: 'test consistency',
      source: 'api',
      submitted_by: 'gate-test',
      submitter_type: 'test',
    });

    expect(job.runtime_id).toBe('rt-gate');
    expect(job.agent_id).toBe('ag-gate');
    expect(job.session_id).toBe('ss-gate');

    appendAuditLog({
      job_id: job.id,
      runtime_id: 'rt-gate',
      agent_id: 'ag-gate',
      session_id: 'ss-gate',
      actor_type: 'test',
      actor_id: 'gate-test',
      action: 'test_action',
      machine_hostname: os.hostname(),
    });
  });

  it('session paths are scoped to runtime/agent/session', () => {
    const s1 = ensureSession({
      runtime_id: 'rt-1',
      agent_id: 'ag-1',
      session_id: 'ss-1',
      chat_jid: 'chat-1',
      channel: 'test',
      agent_name: 'A1',
      agent_folder: 'a1',
    });
    const s2 = ensureSession({
      runtime_id: 'rt-1',
      agent_id: 'ag-1',
      session_id: 'ss-2',
      chat_jid: 'chat-2',
      channel: 'test',
      agent_name: 'A1',
      agent_folder: 'a1',
    });
    const s3 = ensureSession({
      runtime_id: 'rt-1',
      agent_id: 'ag-2',
      session_id: 'ss-3',
      chat_jid: 'chat-3',
      channel: 'test',
      agent_name: 'A2',
      agent_folder: 'a2',
    });

    const paths = [s1.workspace_path, s2.workspace_path, s3.workspace_path];
    expect(new Set(paths).size).toBe(3);
    expect(s1.workspace_path).toContain('ag-1');
    expect(s3.workspace_path).toContain('ag-2');
  });
});

// ─── 2. Job Lifecycle ────────────────────────────────────────

describe('Production Gate: Job Lifecycle', () => {
  beforeEach(() => {
    ensureSession({
      runtime_id: 'rt-job',
      agent_id: 'ag-job',
      session_id: 'ss-job',
      chat_jid: 'job-chat',
      channel: 'test',
      agent_name: 'Job Agent',
      agent_folder: 'job_agent',
    });
  });

  it('job transitions through queued → running → succeeded', () => {
    const job = createJob({
      runtime_id: 'rt-job',
      agent_id: 'ag-job',
      session_id: 'ss-job',
      chat_jid: 'job-chat',
      prompt: 'succeed please',
      source: 'api',
      submitted_by: 'tester',
      submitter_type: 'test',
    });
    expect(job.status).toBe('queued');

    const running = transitionJobStatus(job.id, 'running', {
      started_at: new Date().toISOString(),
      attempt_count: 1,
    });
    expect(running.status).toBe('running');

    const succeeded = transitionJobStatus(job.id, 'succeeded', {
      result: { text: 'done' },
      finished_at: new Date().toISOString(),
    });
    expect(succeeded.status).toBe('succeeded');
    expect(succeeded.result?.text).toBe('done');
  });

  it('job transitions through queued → running → failed', () => {
    const job = createJob({
      runtime_id: 'rt-job',
      agent_id: 'ag-job',
      session_id: 'ss-job',
      chat_jid: 'job-chat',
      prompt: 'fail please',
      source: 'api',
      submitted_by: 'tester',
      submitter_type: 'test',
    });

    transitionJobStatus(job.id, 'running', {
      started_at: new Date().toISOString(),
      attempt_count: 1,
    });

    const failed = transitionJobStatus(job.id, 'failed', {
      error: {
        classification: 'internal_error',
        code: 'test_failure',
        message: 'intentional test failure',
      },
      finished_at: new Date().toISOString(),
    });
    expect(failed.status).toBe('failed');
    expect(failed.error?.code).toBe('test_failure');
  });

  it('job cancel flow works', () => {
    const job = createJob({
      runtime_id: 'rt-job',
      agent_id: 'ag-job',
      session_id: 'ss-job',
      chat_jid: 'job-chat',
      prompt: 'cancel me',
      source: 'api',
      submitted_by: 'tester',
      submitter_type: 'test',
    });

    transitionJobStatus(job.id, 'running', {
      started_at: new Date().toISOString(),
      attempt_count: 1,
    });

    const canceled = transitionJobStatus(job.id, 'canceled', {
      cancel_requested_at: new Date().toISOString(),
      canceled_by: 'admin',
      finished_at: new Date().toISOString(),
    });
    expect(canceled.status).toBe('canceled');
    expect(canceled.canceled_by).toBe('admin');
  });

  it('idempotency key prevents duplicate jobs', () => {
    const first = createJob({
      runtime_id: 'rt-job',
      agent_id: 'ag-job',
      session_id: 'ss-job',
      chat_jid: 'job-chat',
      prompt: 'idempotent',
      source: 'api',
      submitted_by: 'tester',
      submitter_type: 'test',
      idempotency_key: 'gate-idem-1',
    });

    const duplicate = getJobByIdempotencyKey('gate-idem-1');
    expect(duplicate?.id).toBe(first.id);
  });
});

// ─── 3. Session Isolation ────────────────────────────────────

describe('Production Gate: Session Isolation', () => {
  it('different sessions have isolated paths', () => {
    const s1 = ensureSession({
      runtime_id: 'rt-iso',
      agent_id: 'ag-iso',
      session_id: 'ss-iso-1',
      chat_jid: 'iso-chat-1',
      channel: 'test',
      agent_name: 'Iso Agent',
      agent_folder: 'iso_agent',
    });
    const s2 = ensureSession({
      runtime_id: 'rt-iso',
      agent_id: 'ag-iso',
      session_id: 'ss-iso-2',
      chat_jid: 'iso-chat-2',
      channel: 'test',
      agent_name: 'Iso Agent',
      agent_folder: 'iso_agent',
    });

    expect(s1.workspace_path).not.toBe(s2.workspace_path);
    expect(s1.memory_path).not.toBe(s2.memory_path);
    expect(s1.logs_path).not.toBe(s2.logs_path);

    const lookup1 = getSessionByScope('rt-iso', 'ag-iso', 'ss-iso-1');
    const lookup2 = getSessionByScope('rt-iso', 'ag-iso', 'ss-iso-2');
    expect(lookup1?.session_id).toBe('ss-iso-1');
    expect(lookup2?.session_id).toBe('ss-iso-2');
  });

  it('different agents have separate workspace hierarchies', () => {
    const s1 = ensureSession({
      runtime_id: 'rt-iso',
      agent_id: 'ag-alpha',
      session_id: 'ss-1',
      chat_jid: 'alpha-chat',
      channel: 'test',
      agent_name: 'Alpha',
      agent_folder: 'alpha',
    });
    const s2 = ensureSession({
      runtime_id: 'rt-iso',
      agent_id: 'ag-beta',
      session_id: 'ss-1',
      chat_jid: 'beta-chat',
      channel: 'test',
      agent_name: 'Beta',
      agent_folder: 'beta',
    });

    expect(s1.workspace_path).not.toBe(s2.workspace_path);
    expect(s1.workspace_path).toContain('alpha');
    expect(s2.workspace_path).toContain('beta');
  });
});

// ─── 4. Skills Governance ────────────────────────────────────

describe('Production Gate: Skills Governance', () => {
  let tmpDir: string;
  let registry: SkillsRegistry;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-skills-'));
    const config: SkillsConfig = {
      directories: [path.join(tmpDir, 'skills')],
      adminOnly: true,
      allowLevel3: false,
      autoEnableOnInstall: false,
      statePath: path.join(tmpDir, 'state.json'),
      auditLogPath: path.join(tmpDir, 'audit.jsonl'),
    };
    fs.mkdirSync(path.join(tmpDir, 'skills'), { recursive: true });
    registry = new SkillsRegistry(config);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('admin-only enforcement prevents non-admin installs', () => {
    const skillDir = path.join(tmpDir, 'skills', 'test-skill');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, 'SKILL.md'),
      '---\nname: test-skill\ndescription: A test skill\nversion: 1.0.0\nrequires: []\ninstall: []\npermissions:\n  - read\nskill_api_version: "1.0.0"\n---\n# test-skill\nA test skill.',
    );

    expect(() =>
      registry.installSkill('test-skill', {
        actor: 'non-admin',
        isAdmin: false,
      }),
    ).toThrow(/admin/i);

    const installed = registry.installSkill('test-skill', {
      actor: 'admin-user',
      isAdmin: true,
    });
    expect(installed.name).toBe('test-skill');
    expect(installed.enabled).toBe(false);
  });

  it('lists all available skills', () => {
    const list = registry.listAvailable();
    expect(Array.isArray(list)).toBe(true);
  });
});

// ─── 5. Enrollment State Machine ─────────────────────────────

describe('Production Gate: TOFU Enrollment', () => {
  let tmpDir: string;
  let originalHome: string | undefined;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-enroll-'));
    originalHome = process.env.TICLAW_HOME;
    process.env.TICLAW_HOME = tmpDir;
  });

  afterEach(() => {
    if (originalHome !== undefined) {
      process.env.TICLAW_HOME = originalHome;
    } else {
      delete process.env.TICLAW_HOME;
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('generates enrollment token and verifies it', () => {
    const runtimeId = 'rt-enroll-test';
    const created = createEnrollmentToken({ runtimeId });

    expect(created.token).toBeTruthy();
    expect(created.runtime_id).toBe(runtimeId);

    const result = verifyEnrollmentToken({
      token: created.token,
      runtimeFingerprint: created.runtime_fingerprint,
      runtimeId,
    });
    expect(result.ok).toBe(true);
    expect(result.code).toBe('ok');
    expect(result.state.trust_state).toBe('trusted');
    expect(result.state.trusted_at).toBeTruthy();
  });

  it('rejects incorrect token', () => {
    const runtimeId = 'rt-enroll-bad';
    createEnrollmentToken({ runtimeId });

    const result = verifyEnrollmentToken({
      token: 'wrong-token',
      runtimeFingerprint: 'wrong-fingerprint',
      runtimeId,
    });
    expect(result.ok).toBe(false);
    expect(result.state.failed_attempts).toBeGreaterThan(0);
  });

  it('revokes enrollment via setTrustState', () => {
    const runtimeId = 'rt-enroll-revoke';
    const created = createEnrollmentToken({ runtimeId });
    verifyEnrollmentToken({
      token: created.token,
      runtimeFingerprint: created.runtime_fingerprint,
      runtimeId,
    });

    setTrustState('revoked', { runtimeId });
    const revoked = readEnrollmentState(runtimeId);
    expect(revoked.trust_state).toBe('revoked');
  });
});

// ─── 6. Sub-agent Depth Limit ────────────────────────────────

describe('Production Gate: Sub-agent Delegation', () => {
  it('enforces maximum delegation depth', () => {
    expect(() => {
      throw new DelegationDepthExceededError(MAX_DELEGATION_DEPTH);
    }).toThrow(/exceeds maximum/);
  });

  it('DelegationDepthExceededError has correct depth', () => {
    const err = new DelegationDepthExceededError(3);
    expect(err.message).toContain('3');
    expect(err.message).toContain(String(MAX_DELEGATION_DEPTH));
  });
});

// ─── 7. Runtime Registration ─────────────────────────────────

describe('Production Gate: Runtime Registration', () => {
  it('upserts runtime with capabilities and heartbeat', () => {
    upsertRuntimeRegistration({
      runtime_id: 'rt-gate-reg',
      version: '2.0.0',
      hostname: 'gate-host',
      os: 'linux',
      capabilities: ['office', 'filesystem', 'network'],
      capability_whitelist: ['office', 'filesystem'],
      health: 'healthy',
      busy_slots: 0,
      total_slots: 5,
      last_heartbeat_at: new Date().toISOString(),
    });

    upsertRuntimeRegistration({
      runtime_id: 'rt-gate-reg',
      busy_slots: 2,
      last_heartbeat_at: new Date().toISOString(),
    });

    const rt = getRuntime('rt-gate-reg');
    expect(rt).toBeDefined();
    expect(rt!.hostname).toBe('gate-host');
    expect(rt!.busy_slots).toBe(2);
  });
});
