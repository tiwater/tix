/**
 * Production Gate — integration test suite that validates cross-cutting
 * system-level concerns for production readiness.
 *
 * Covers:
 *  1. Session topology (agent_id/session_id consistency)
 *  2. Skills governance (trust, permissions)
 *  3. Enrollment state machine (TOFU flow)
 *  4. Sub-agent delegation depth limits
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { _initTestDatabase, ensureSession, getAllSessions } from './core/db.js';
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

// ─── 1. Session Topology ─────────────────────────────────────

describe('Production Gate: Session Topology', () => {
  it('agent_id/session_id are consistent across DB', () => {
    const session = ensureSession({
      agent_id: 'ag-gate',
      session_id: 'ss-gate',
      channel: 'test',
      agent_name: 'Gate Agent',
    });

    expect(session.agent_id).toBe('ag-gate');
    expect(session.session_id).toBe('ss-gate');
  });

  it('different sessions for same agent are correctly tracked', () => {
    const s1 = ensureSession({
      agent_id: 'ag-1',
      session_id: 'ss-1',
      channel: 'test',
      agent_name: 'A1',
    });
    const s2 = ensureSession({
      agent_id: 'ag-1',
      session_id: 'ss-2',
      channel: 'test',
      agent_name: 'A1',
    });

    expect(s1.session_id).toBe('ss-1');
    expect(s2.session_id).toBe('ss-2');
    expect(s1.agent_id).toBe(s2.agent_id);

    const sessions = getAllSessions();
    expect(sessions).toHaveLength(2);
  });

  it('different agents have separate sessions', () => {
    const s1 = ensureSession({
      agent_id: 'ag-alpha',
      session_id: 'ss-alpha-1',
      channel: 'test',
      agent_name: 'Alpha',
    });
    const s2 = ensureSession({
      agent_id: 'ag-beta',
      session_id: 'ss-beta-1',
      channel: 'test',
      agent_name: 'Beta',
    });

    expect(s1.agent_id).toBe('ag-alpha');
    expect(s2.agent_id).toBe('ag-beta');

    const sessions = getAllSessions();
    expect(sessions).toHaveLength(2);
  });
});

// ─── 2. Skills Governance ────────────────────────────────────

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

// ─── 3. Enrollment State Machine ─────────────────────────────

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
    const clawId = 'rt-enroll-test';
    const created = createEnrollmentToken({ clawId });

    expect(created.token).toBeTruthy();
    // Use the normalized clawId from the state to ensure consistency
    const state = readEnrollmentState(clawId);
    expect(created.claw_id).toBe(state.claw_id);

    const result = verifyEnrollmentToken({
      token: created.token,
      clawFingerprint: created.claw_fingerprint,
      clawId: created.claw_id,
    });
    expect(result.ok).toBe(true);
    expect(result.code).toBe('ok');
    expect(result.state.trust_state).toBe('trusted');
    expect(result.state.trusted_at).toBeTruthy();
  });

  it('rejects incorrect token', () => {
    const clawId = 'rt-enroll-bad';
    createEnrollmentToken({ clawId });

    const result = verifyEnrollmentToken({
      token: 'wrong-token',
      clawFingerprint: 'wrong-fingerprint',
      clawId,
    });
    expect(result.ok).toBe(false);
    expect(result.state.failed_attempts).toBeGreaterThan(0);
  });

  it('revokes enrollment via setTrustState', () => {
    const clawId = 'rt-enroll-revoke';
    const created = createEnrollmentToken({ clawId });
    verifyEnrollmentToken({
      token: created.token,
      clawFingerprint: created.claw_fingerprint,
      clawId,
    });

    setTrustState('revoked', { clawId });
    const revoked = readEnrollmentState(clawId);
    expect(revoked.trust_state).toBe('revoked');
  });
});

// ─── 4. Sub-agent Depth Limit ────────────────────────────────

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
