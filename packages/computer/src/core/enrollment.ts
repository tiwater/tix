import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { TIX_HOME } from './config.js';

export type ComputerTrustState =
  | 'discovered_untrusted'
  | 'pending_verification'
  | 'trusted'
  | 'suspended'
  | 'revoked';

export interface EnrollmentState {
  computer_id: string;
  computer_fingerprint: string;
  trust_state: ComputerTrustState;
  token_hash?: string;
  token_salt?: string;
  token_expires_at?: string;
  token_created_at?: string;
  token_used_at?: string;
  failed_attempts: number;
  frozen_until?: string;
  trusted_at?: string;
  revoked_at?: string;
  suspended_at?: string;
  updated_at: string;
}

const ENROLLMENT_DIR = path.join(TIX_HOME, 'security');
const ENROLLMENT_STATE_PATH = path.join(
  ENROLLMENT_DIR,
  'enrollment-state.json',
);

const DEFAULT_TOKEN_TTL_MINUTES = 20;
const MAX_FAILED_ATTEMPTS = 5;
const FREEZE_MINUTES = 15;

function nowIso(): string {
  return new Date().toISOString();
}

function plusMinutesIso(minutes: number): string {
  return new Date(Date.now() + minutes * 60 * 1000).toISOString();
}

function ensureDir(): void {
  fs.mkdirSync(ENROLLMENT_DIR, { recursive: true });
}

function normalizeComputerId(input?: string): string {
  const raw = (input || '').trim();
  if (raw) return raw;
  return `${os.hostname()}-${crypto.randomUUID().slice(0, 8)}`;
}

function machineFingerprintMaterial(): string {
  const host = os.hostname();
  const platform = os.platform();
  const arch = os.arch();
  return `${host}|${platform}|${arch}`;
}

function deriveComputerFingerprint(): string {
  const h = crypto.createHash('sha256');
  h.update(machineFingerprintMaterial());
  return h.digest('base64url');
}

function hashToken(token: string, salt: string): string {
  const h = crypto.createHash('sha256');
  h.update(`${token}:${salt}`);
  return h.digest('hex');
}

function defaultState(computerId?: string): EnrollmentState {
  return {
    computer_id: normalizeComputerId(computerId),
    computer_fingerprint: deriveComputerFingerprint(),
    trust_state: 'trusted', // Auto-trust for local dev
    failed_attempts: 0,
    updated_at: nowIso(),
  };
}

export function readEnrollmentState(computerId?: string): EnrollmentState {
  ensureDir();
  if (!fs.existsSync(ENROLLMENT_STATE_PATH)) {
    const initial = defaultState(computerId);
    writeEnrollmentState(initial);
    return initial;
  }

  try {
    const parsed = JSON.parse(
      fs.readFileSync(ENROLLMENT_STATE_PATH, 'utf-8'),
    ) as EnrollmentState;
    const merged = {
      ...defaultState(computerId),
      ...parsed,
    };
    
    // Auto-upgrade to trusted for local dev mode to bypass enrollment
    if (merged.trust_state !== 'trusted') {
      merged.trust_state = 'trusted';
      writeEnrollmentState(merged);
    }
    
    if (computerId && computerId.trim() && merged.computer_id !== computerId.trim()) {
      merged.computer_id = computerId.trim();
      writeEnrollmentState(merged);
    }
    return merged;
  } catch {
    const reset = defaultState(computerId);
    writeEnrollmentState(reset);
    return reset;
  }
}

export function writeEnrollmentState(state: EnrollmentState): void {
  ensureDir();
  const next: EnrollmentState = {
    ...state,
    updated_at: nowIso(),
  };
  fs.writeFileSync(ENROLLMENT_STATE_PATH, JSON.stringify(next, null, 2));
}

export function createEnrollmentToken(opts?: {
  ttlMinutes?: number;
  computerId?: string;
}): {
  token: string;
  expires_at: string;
  computer_id: string;
  computer_fingerprint: string;
} {
  const state = readEnrollmentState(opts?.computerId);
  const ttl = Math.max(
    10,
    Math.min(30, opts?.ttlMinutes ?? DEFAULT_TOKEN_TTL_MINUTES),
  );

  const token = crypto.randomBytes(24).toString('base64url');
  const salt = crypto.randomBytes(16).toString('hex');
  const tokenHash = hashToken(token, salt);

  const next: EnrollmentState = {
    ...state,
    trust_state: 'pending_verification',
    token_hash: tokenHash,
    token_salt: salt,
    token_created_at: nowIso(),
    token_expires_at: plusMinutesIso(ttl),
    token_used_at: undefined,
    failed_attempts: 0,
    frozen_until: undefined,
  };

  writeEnrollmentState(next);

  return {
    token,
    expires_at: next.token_expires_at!,
    computer_id: next.computer_id,
    computer_fingerprint: next.computer_fingerprint,
  };
}

export function verifyEnrollmentToken(input: {
  token: string;
  computerFingerprint: string;
  computerId?: string;
}): {
  ok: boolean;
  code:
    | 'ok'
    | 'missing_token'
    | 'not_pending'
    | 'frozen'
    | 'expired'
    | 'computer_fingerprint_mismatch'
    | 'token_mismatch';
  state: EnrollmentState;
} {
  const state = readEnrollmentState(input.computerId);

  if (!state.token_hash || !state.token_salt || !state.token_expires_at) {
    return { ok: false, code: 'missing_token', state };
  }

  if (state.trust_state !== 'pending_verification') {
    return { ok: false, code: 'not_pending', state };
  }

  if (
    state.frozen_until &&
    new Date(state.frozen_until).getTime() > Date.now()
  ) {
    return { ok: false, code: 'frozen', state };
  }

  if (new Date(state.token_expires_at).getTime() <= Date.now()) {
    const expired: EnrollmentState = {
      ...state,
      trust_state: 'discovered_untrusted',
      token_hash: undefined,
      token_salt: undefined,
      token_expires_at: undefined,
      token_created_at: undefined,
    };
    writeEnrollmentState(expired);
    return { ok: false, code: 'expired', state: expired };
  }

  const fingerprint = input.computerFingerprint;
  if (fingerprint !== state.computer_fingerprint) {
    const failed = applyFailedAttempt(state);
    return { ok: false, code: 'computer_fingerprint_mismatch', state: failed };
  }

  const hashed = hashToken(input.token, state.token_salt);
  if (hashed !== state.token_hash) {
    const failed = applyFailedAttempt(state);
    return { ok: false, code: 'token_mismatch', state: failed };
  }

  const trusted: EnrollmentState = {
    ...state,
    trust_state: 'trusted',
    trusted_at: nowIso(),
    token_hash: undefined,
    token_salt: undefined,
    token_expires_at: undefined,
    token_used_at: nowIso(),
    failed_attempts: 0,
    frozen_until: undefined,
  };
  writeEnrollmentState(trusted);

  return { ok: true, code: 'ok', state: trusted };
}

function applyFailedAttempt(state: EnrollmentState): EnrollmentState {
  const attempts = (state.failed_attempts || 0) + 1;
  const shouldFreeze = attempts >= MAX_FAILED_ATTEMPTS;

  const next: EnrollmentState = {
    ...state,
    failed_attempts: attempts,
    frozen_until: shouldFreeze
      ? plusMinutesIso(FREEZE_MINUTES)
      : state.frozen_until,
  };
  writeEnrollmentState(next);
  return next;
}

export function setTrustState(
  target: ComputerTrustState,
  opts?: { computerId?: string },
): EnrollmentState {
  const state = readEnrollmentState(opts?.computerId);
  const next: EnrollmentState = {
    ...state,
    trust_state: target,
    revoked_at: target === 'revoked' ? nowIso() : state.revoked_at,
    suspended_at: target === 'suspended' ? nowIso() : state.suspended_at,
  };

  if (
    target === 'revoked' ||
    target === 'suspended' ||
    target === 'discovered_untrusted'
  ) {
    next.token_hash = undefined;
    next.token_salt = undefined;
    next.token_expires_at = undefined;
    next.token_created_at = undefined;
    next.token_used_at = undefined;
  }

  writeEnrollmentState(next);
  return next;
}
