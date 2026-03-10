/**
 * HTTP SSE channel for TiClaw.
 *
 * Routes:
 *   POST /runtime/register
 *   POST /runtime/heartbeat
 *   POST /jobs
 *   GET  /jobs/:id
 *   POST /jobs/:id/cancel
 *   POST /jobs/:id/retry
 *   GET  /jobs/:id/logs
 *   GET  /jobs/:id/artifacts
 *   POST /runs
 *   GET  /runs/:id/stream
 *   GET  /agents
 *   GET  /api/mind
 *   GET  /health
 */

import { execFileSync } from 'child_process';
import fs from 'fs';
import http from 'http';
import path from 'path';
import { randomUUID } from 'crypto';
import { URL } from 'url';

import {
  CONTROL_PLANE_RUNTIME_ID,
  DEFAULT_RUNTIME_ID,
  HTTP_ENABLED,
  HTTP_PORT,
  RUNTIME_API_KEY,
  RUNTIME_CONCURRENCY_LIMIT,
} from '../core/config.js';
import {
  appendAuditLog,
  ensureSession,
  getJobById,
  getMindState,
  getSessionByChatJid,
  getSessionByScope,
  upsertRuntimeRegistration,
} from '../core/db.js';
import {
  createEnrollmentToken,
  readEnrollmentState,
  setTrustState,
  verifyEnrollmentToken,
} from '../core/enrollment.js';
import { logger } from '../core/logger.js';
import { getJobLogPath } from '../run-agent.js';
import {
  cancelJob,
  getExecutorRuntimeStats,
  retryJob,
  submitJob,
} from '../job-executor.js';
import { registerChannel, ChannelOpts } from './registry.js';
import type {
  Channel,
  JobRecord,
  JobStatus,
  NewMessage,
  RegisteredProject,
  SessionContext,
} from '../core/types.js';

const WEB_JID_PREFIX = 'web:';
const MAX_ARTIFACTS = 200;

const sseClients = new Map<string, Set<http.ServerResponse>>();
const activeHttpJobs = new Map<
  string,
  {
    runtime_id: string;
    agent_id: string;
    session_id: string;
    job_id: string;
  }
>();

function safeAgentFolder(agentId: string): string {
  return agentId.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64) || 'agent';
}

function buildHttpChatJid(
  runtimeId: string,
  agentId: string,
  sessionId: string,
): string {
  return `${WEB_JID_PREFIX}${encodeURIComponent(runtimeId)}:${encodeURIComponent(agentId)}:${encodeURIComponent(sessionId)}`;
}

function addClient(chatJid: string, res: http.ServerResponse): void {
  if (!sseClients.has(chatJid)) sseClients.set(chatJid, new Set());
  sseClients.get(chatJid)!.add(res);
}

function removeClient(chatJid: string, res: http.ServerResponse): void {
  sseClients.get(chatJid)?.delete(res);
}

function broadcastToChat(chatJid: string, event: object): void {
  const clients = sseClients.get(chatJid);
  if (!clients || clients.size === 0) return;
  const payload = `data: ${JSON.stringify(event)}\n\n`;
  for (const res of clients) {
    try {
      res.write(payload);
    } catch {
      clients.delete(res);
    }
  }
}

function setCorsHeaders(res: http.ServerResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Authorization, Content-Type, Idempotency-Key, X-API-Key',
  );
}

function writeJson(
  res: http.ServerResponse,
  statusCode: number,
  payload: unknown,
): void {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

function buildProtocolError(
  classification: string,
  code: string,
  message: string,
  details?: Record<string, unknown>,
): {
  error: {
    classification: string;
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
} {
  return {
    error: {
      classification,
      code,
      message,
      ...(details ? { details } : {}),
    },
  };
}

function writeProtocolError(
  res: http.ServerResponse,
  statusCode: number,
  classification: string,
  code: string,
  message: string,
  details?: Record<string, unknown>,
): void {
  writeJson(
    res,
    statusCode,
    buildProtocolError(classification, code, message, details),
  );
}

async function readJsonBody(req: http.IncomingMessage): Promise<any> {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
  }
  if (!body) return {};
  try {
    return JSON.parse(body);
  } catch {
    throw new Error('Invalid JSON body');
  }
}

function getApiKey(req: http.IncomingMessage): string {
  const headerKey = req.headers['x-api-key'];
  if (typeof headerKey === 'string' && headerKey.trim())
    return headerKey.trim();

  const auth = req.headers.authorization;
  if (typeof auth === 'string' && auth.startsWith('Bearer ')) {
    return auth.slice('Bearer '.length).trim();
  }
  return '';
}

function requireApiKey(req: http.IncomingMessage): string {
  if (!RUNTIME_API_KEY) {
    throw Object.assign(new Error('Runtime API key is not configured'), {
      statusCode: 503,
      classification: 'env_error',
      code: 'runtime_api_key_missing',
    });
  }
  const provided = getApiKey(req);
  if (!provided || provided !== RUNTIME_API_KEY) {
    throw Object.assign(new Error('Invalid runtime API key'), {
      statusCode: 401,
      classification: 'permission_error',
      code: 'invalid_api_key',
    });
  }
  return 'runtime-api-key';
}

function parseLimit(
  value: string | null,
  fallback: number,
  max: number,
): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
}

function serializeJob(job: JobRecord): Record<string, unknown> {
  return {
    id: job.id,
    runtime_id: job.runtime_id,
    agent_id: job.agent_id,
    session_id: job.session_id,
    chat_jid: job.chat_jid,
    source: job.source,
    source_ref: job.source_ref || null,
    status: job.status,
    prompt: job.prompt,
    submitted_by: job.submitted_by,
    submitter_type: job.submitter_type,
    idempotency_key: job.idempotency_key || null,
    required_capabilities: job.required_capabilities,
    timeout_ms: job.timeout_ms,
    step_timeout_ms: job.step_timeout_ms || null,
    max_retries: job.max_retries,
    retry_backoff_ms: job.retry_backoff_ms,
    attempt_count: job.attempt_count,
    next_attempt_at: job.next_attempt_at,
    last_activity_at: job.last_activity_at || null,
    cancel_requested_at: job.cancel_requested_at || null,
    canceled_by: job.canceled_by || null,
    result: job.result || null,
    error: job.error || null,
    metadata: job.metadata || null,
    created_at: job.created_at,
    updated_at: job.updated_at,
    started_at: job.started_at || null,
    finished_at: job.finished_at || null,
    links: {
      self: `/jobs/${job.id}`,
      logs: `/jobs/${job.id}/logs`,
      artifacts: `/jobs/${job.id}/artifacts`,
    },
  };
}

function protocolErrorFromUnknown(err: unknown): {
  statusCode: number;
  classification: string;
  code: string;
  message: string;
} {
  const anyErr = err as any;
  if (
    typeof anyErr?.statusCode === 'number' &&
    typeof anyErr?.classification === 'string' &&
    typeof anyErr?.code === 'string'
  ) {
    return {
      statusCode: anyErr.statusCode,
      classification: anyErr.classification,
      code: anyErr.code,
      message: anyErr.message || String(err),
    };
  }

  const message = err instanceof Error ? err.message : String(err);
  if (message === 'Invalid JSON body') {
    return {
      statusCode: 400,
      classification: 'input_error',
      code: 'invalid_json',
      message,
    };
  }
  if (message.toLowerCase().includes('not found')) {
    return {
      statusCode: 404,
      classification: 'input_error',
      code: 'not_found',
      message,
    };
  }
  if (message.toLowerCase().includes('retryable')) {
    return {
      statusCode: 409,
      classification: 'input_error',
      code: 'job_not_retryable',
      message,
    };
  }
  return {
    statusCode: 500,
    classification: 'internal_error',
    code: 'internal_error',
    message,
  };
}

function ensureJob(jobId: string): JobRecord {
  const job = getJobById(jobId);
  if (!job) {
    throw Object.assign(new Error(`Job not found: ${jobId}`), {
      statusCode: 404,
      classification: 'input_error',
      code: 'job_not_found',
    });
  }
  return job;
}

function getJobSession(job: JobRecord): SessionContext {
  const session = getSessionByScope(
    job.runtime_id,
    job.agent_id,
    job.session_id,
  );
  if (!session) {
    throw Object.assign(new Error(`Session not found for job ${job.id}`), {
      statusCode: 404,
      classification: 'env_error',
      code: 'session_not_found',
    });
  }
  return { ...session, job_id: job.id };
}

function detectArtifactKind(relPath: string): string {
  const normalized = relPath.toLowerCase();
  if (normalized.endsWith('.jsonl') || normalized.endsWith('.log'))
    return 'log';
  if (
    normalized.endsWith('.png') ||
    normalized.endsWith('.jpg') ||
    normalized.endsWith('.jpeg') ||
    normalized.endsWith('.webp')
  ) {
    return 'screenshot';
  }
  if (
    normalized.endsWith('.diff') ||
    normalized.endsWith('.patch') ||
    normalized.endsWith('.rej')
  ) {
    return 'diff';
  }
  if (
    normalized.endsWith('.md') ||
    normalized.endsWith('.txt') ||
    normalized.endsWith('.pdf') ||
    normalized.endsWith('.doc') ||
    normalized.endsWith('.docx')
  ) {
    return 'document';
  }
  return 'file';
}

function walkArtifacts(
  rootDir: string,
  relativeDir = '',
  artifacts: Array<Record<string, unknown>>,
): void {
  if (artifacts.length >= MAX_ARTIFACTS) return;
  const absDir = path.join(rootDir, relativeDir);
  const entries = fs.readdirSync(absDir, { withFileTypes: true });
  for (const entry of entries) {
    if (artifacts.length >= MAX_ARTIFACTS) return;
    if (entry.name === '.git' || entry.name === 'node_modules') continue;

    const relPath = path.join(relativeDir, entry.name);
    const absPath = path.join(rootDir, relPath);
    if (entry.isDirectory()) {
      walkArtifacts(rootDir, relPath, artifacts);
      continue;
    }

    const stat = fs.statSync(absPath);
    artifacts.push({
      path: relPath,
      absolute_path: absPath,
      size_bytes: stat.size,
      modified_at: stat.mtime.toISOString(),
      kind: detectArtifactKind(relPath),
    });
  }
}

function listJobArtifacts(job: JobRecord): Array<Record<string, unknown>> {
  const session = getJobSession(job);
  const artifacts: Array<Record<string, unknown>> = [];

  const logPath = getJobLogPath(session);
  if (fs.existsSync(logPath)) {
    const stat = fs.statSync(logPath);
    artifacts.push({
      path: path.relative(session.workspace_path, logPath),
      absolute_path: logPath,
      size_bytes: stat.size,
      modified_at: stat.mtime.toISOString(),
      kind: 'log',
    });
  }

  if (fs.existsSync(session.workspace_path)) {
    walkArtifacts(session.workspace_path, '', artifacts);

    if (fs.existsSync(path.join(session.workspace_path, '.git'))) {
      artifacts.push({
        path: '__virtual__/git-diff.patch',
        absolute_path: null,
        size_bytes: null,
        modified_at: new Date().toISOString(),
        kind: 'diff',
        source: 'git',
      });
    }
  }

  return artifacts.slice(0, MAX_ARTIFACTS);
}

function readJobLogs(
  job: JobRecord,
  offset: number,
  limit: number,
): {
  items: unknown[];
  has_more: boolean;
  next_offset: number | null;
} {
  const session = getJobSession(job);
  const logPath = getJobLogPath(session);
  if (!fs.existsSync(logPath)) {
    return {
      items: [],
      has_more: false,
      next_offset: null,
    };
  }

  const lines = fs
    .readFileSync(logPath, 'utf-8')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const slice = lines.slice(offset, offset + limit).map((line) => {
    try {
      return JSON.parse(line);
    } catch {
      return { raw: line };
    }
  });
  const nextOffset = offset + slice.length;

  return {
    items: slice,
    has_more: nextOffset < lines.length,
    next_offset: nextOffset < lines.length ? nextOffset : null,
  };
}

function sendVirtualDiff(res: http.ServerResponse, job: JobRecord): void {
  const session = getJobSession(job);
  try {
    const diff = execFileSync(
      'git',
      ['-C', session.workspace_path, 'diff', '--patch', '--stat'],
      {
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore'],
      },
    );
    writeJson(res, 200, {
      job_id: job.id,
      artifact: {
        path: '__virtual__/git-diff.patch',
        kind: 'diff',
        content: diff,
      },
    });
  } catch {
    writeProtocolError(
      res,
      404,
      'input_error',
      'artifact_not_found',
      'Virtual git diff artifact is unavailable',
    );
  }
}

export class HttpChannel implements Channel {
  name = 'http';

  private server: http.Server | null = null;
  private opts: ChannelOpts;
  private _connected = false;

  constructor(opts: ChannelOpts) {
    this.opts = opts;
  }

  async connect(): Promise<void> {
    this.server = http.createServer((req, res) => {
      void this.handleRequest(req, res);
    });

    await new Promise<void>((resolve, reject) => {
      this.server!.listen(HTTP_PORT, () => resolve());
      this.server!.on('error', reject);
    });

    this._connected = true;
    logger.info({ port: HTTP_PORT }, 'HTTP SSE channel listening');
    console.log(
      `\n  HTTP SSE: http://localhost:${HTTP_PORT}/runs/{id}/stream\n`,
    );
  }

  private async handleRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    const url = new URL(req.url ?? '/', `http://localhost:${HTTP_PORT}`);
    const pathname = url.pathname;

    if (req.method === 'OPTIONS') {
      setCorsHeaders(res);
      res.writeHead(204);
      res.end();
      return;
    }

    setCorsHeaders(res);

    try {
      if (pathname === '/health') {
        writeJson(res, 200, { status: 'ok' });
        return;
      }

      if (pathname === '/api/mind' && req.method === 'GET') {
        writeJson(res, 200, getMindState());
        return;
      }

      if (pathname === '/agents' && req.method === 'GET') {
        writeJson(res, 200, {
          name: 'TiClaw',
          description: 'TiClaw AI Agent',
          version: '1.0.0',
        });
        return;
      }

      if (pathname === '/api/enroll/status' && req.method === 'GET') {
        const state = readEnrollmentState(
          CONTROL_PLANE_RUNTIME_ID || undefined,
        );
        writeJson(res, 200, {
          runtime_id: state.runtime_id,
          runtime_fingerprint: state.runtime_fingerprint,
          trust_state: state.trust_state,
          token_expires_at: state.token_expires_at || null,
          failed_attempts: state.failed_attempts,
          frozen_until: state.frozen_until || null,
          trusted_at: state.trusted_at || null,
          revoked_at: state.revoked_at || null,
        });
        return;
      }

      if (pathname === '/api/enroll/token' && req.method === 'POST') {
        const parsed = await readJsonBody(req);
        const ttlMinutes = Number(parsed.ttl_minutes);
        const result = createEnrollmentToken({
          ttlMinutes: Number.isFinite(ttlMinutes) ? ttlMinutes : undefined,
          runtimeId: CONTROL_PLANE_RUNTIME_ID || undefined,
        });
        writeJson(res, 201, result);
        return;
      }

      if (pathname === '/api/enroll/verify' && req.method === 'POST') {
        const parsed = await readJsonBody(req);
        const token = parsed.token;
        const runtimeFingerprint = parsed.runtime_fingerprint;
        if (!token || !runtimeFingerprint) {
          writeProtocolError(
            res,
            400,
            'input_error',
            'bad_request',
            'token and runtime_fingerprint are required',
          );
          return;
        }

        const result = verifyEnrollmentToken({
          token,
          runtimeFingerprint,
          runtimeId: CONTROL_PLANE_RUNTIME_ID || undefined,
        });
        if (!result.ok) {
          const statusCode =
            result.code === 'frozen'
              ? 423
              : result.code === 'expired'
                ? 410
                : 401;
          writeJson(res, statusCode, {
            ok: false,
            code: result.code,
            trust_state: result.state.trust_state,
          });
          return;
        }

        writeJson(res, 200, {
          ok: true,
          code: 'ok',
          trust_state: result.state.trust_state,
          trusted_at: result.state.trusted_at,
        });
        return;
      }

      if (pathname === '/api/enroll/revoke' && req.method === 'POST') {
        const state = setTrustState('revoked', {
          runtimeId: CONTROL_PLANE_RUNTIME_ID || undefined,
        });
        writeJson(res, 200, { ok: true, trust_state: state.trust_state });
        return;
      }

      if (pathname === '/api/enroll/suspend' && req.method === 'POST') {
        const state = setTrustState('suspended', {
          runtimeId: CONTROL_PLANE_RUNTIME_ID || undefined,
        });
        writeJson(res, 200, { ok: true, trust_state: state.trust_state });
        return;
      }

      if (pathname === '/api/enroll/reenroll' && req.method === 'POST') {
        const state = setTrustState('discovered_untrusted', {
          runtimeId: CONTROL_PLANE_RUNTIME_ID || undefined,
        });
        writeJson(res, 200, { ok: true, trust_state: state.trust_state });
        return;
      }

      if (pathname === '/runtime/register' && req.method === 'POST') {
        const actorId = requireApiKey(req);
        const parsed = await readJsonBody(req);
        if (!parsed.runtime_id) {
          writeProtocolError(
            res,
            400,
            'input_error',
            'runtime_id_required',
            'runtime_id is required',
          );
          return;
        }
        const stats = getExecutorRuntimeStats(parsed.runtime_id);
        const record = upsertRuntimeRegistration({
          runtime_id: parsed.runtime_id,
          version: parsed.version,
          hostname: parsed.hostname,
          os: parsed.os,
          capabilities: Array.isArray(parsed.capabilities)
            ? parsed.capabilities
            : [],
          capability_whitelist: Array.isArray(parsed.capability_whitelist)
            ? parsed.capability_whitelist
            : undefined,
          health: parsed.health,
          busy_slots: parsed.busy_slots ?? stats.busy_slots,
          total_slots: parsed.total_slots ?? stats.total_slots,
          last_heartbeat_at: new Date().toISOString(),
        });
        appendAuditLog({
          runtime_id: record.runtime_id,
          actor_type: 'api_key',
          actor_id: actorId,
          action: 'runtime_registered',
          result: 'ok',
          machine_hostname: record.hostname || 'unknown',
          details: {
            version: record.version,
            health: record.health,
            capabilities: record.capabilities,
          },
        });
        writeJson(res, 200, record);
        return;
      }

      if (pathname === '/runtime/heartbeat' && req.method === 'POST') {
        const actorId = requireApiKey(req);
        const parsed = await readJsonBody(req);
        if (!parsed.runtime_id) {
          writeProtocolError(
            res,
            400,
            'input_error',
            'runtime_id_required',
            'runtime_id is required',
          );
          return;
        }
        const stats = getExecutorRuntimeStats(parsed.runtime_id);
        const record = upsertRuntimeRegistration({
          runtime_id: parsed.runtime_id,
          version: parsed.version,
          hostname: parsed.hostname,
          os: parsed.os,
          capabilities: Array.isArray(parsed.capabilities)
            ? parsed.capabilities
            : undefined,
          health: parsed.health,
          busy_slots: parsed.busy_slots ?? stats.busy_slots,
          total_slots: parsed.total_slots ?? stats.total_slots,
          last_heartbeat_at: new Date().toISOString(),
        });
        appendAuditLog({
          runtime_id: record.runtime_id,
          actor_type: 'api_key',
          actor_id: actorId,
          action: 'runtime_heartbeat',
          result: 'ok',
          machine_hostname: record.hostname || 'unknown',
          details: {
            health: record.health,
            busy_slots: record.busy_slots,
            total_slots: record.total_slots,
          },
        });
        writeJson(res, 200, record);
        return;
      }

      if (pathname === '/jobs' && req.method === 'POST') {
        const actorId = requireApiKey(req);
        const parsed = await readJsonBody(req);
        const runtimeId =
          parsed.runtime_id || CONTROL_PLANE_RUNTIME_ID || DEFAULT_RUNTIME_ID;
        const agentId =
          typeof parsed.agent_id === 'string' ? parsed.agent_id.trim() : '';
        const sessionId =
          typeof parsed.session_id === 'string' ? parsed.session_id.trim() : '';
        const prompt =
          typeof parsed.prompt === 'string'
            ? parsed.prompt
            : typeof parsed.content === 'string'
              ? parsed.content
              : '';
        if (!agentId || !sessionId || !prompt.trim()) {
          writeProtocolError(
            res,
            400,
            'input_error',
            'invalid_job_request',
            'agent_id, session_id, and prompt are required',
          );
          return;
        }

        const chatJid = buildHttpChatJid(runtimeId, agentId, sessionId);
        const projects = this.opts.registeredProjects();
        if (!projects[chatJid] && this.opts.onGroupRegistered) {
          const group: RegisteredProject = {
            name: agentId,
            folder: safeAgentFolder(agentId),
            runtime_id: runtimeId,
            agent_id: agentId,
            trigger: '',
            added_at: new Date().toISOString(),
            requiresTrigger: false,
            isMain: false,
          };
          this.opts.onGroupRegistered(chatJid, group);
        }

        ensureSession({
          runtime_id: runtimeId,
          agent_id: agentId,
          session_id: sessionId,
          chat_jid: chatJid,
          channel: 'http',
          agent_name: agentId,
          agent_folder: safeAgentFolder(agentId),
        });
        this.opts.onChatMetadata(
          chatJid,
          new Date().toISOString(),
          undefined,
          'http',
          false,
        );

        const idempotencyHeader = req.headers['idempotency-key'];
        const idempotencyKey =
          typeof parsed.idempotency_key === 'string' && parsed.idempotency_key
            ? parsed.idempotency_key
            : typeof idempotencyHeader === 'string'
              ? idempotencyHeader
              : undefined;

        const job = submitJob({
          runtime_id: runtimeId,
          agent_id: agentId,
          session_id: sessionId,
          chat_jid: chatJid,
          prompt,
          source: 'api',
          submitted_by:
            typeof parsed.submitted_by === 'string' &&
            parsed.submitted_by.trim()
              ? parsed.submitted_by.trim()
              : actorId,
          submitter_type: 'api_key',
          idempotency_key: idempotencyKey,
          required_capabilities: Array.isArray(parsed.required_capabilities)
            ? parsed.required_capabilities
            : [],
          timeout_ms:
            typeof parsed.timeout_ms === 'number'
              ? parsed.timeout_ms
              : undefined,
          step_timeout_ms:
            typeof parsed.step_timeout_ms === 'number'
              ? parsed.step_timeout_ms
              : undefined,
          max_retries:
            typeof parsed.max_retries === 'number'
              ? parsed.max_retries
              : undefined,
          retry_backoff_ms:
            typeof parsed.retry_backoff_ms === 'number'
              ? parsed.retry_backoff_ms
              : undefined,
          metadata:
            parsed.metadata && typeof parsed.metadata === 'object'
              ? parsed.metadata
              : undefined,
        });

        activeHttpJobs.set(chatJid, {
          runtime_id: runtimeId,
          agent_id: agentId,
          session_id: sessionId,
          job_id: job.id,
        });

        writeJson(res, 202, serializeJob(job));
        return;
      }

      const jobMatch = pathname.match(/^\/jobs\/([^/]+)$/);
      if (jobMatch && req.method === 'GET') {
        requireApiKey(req);
        const job = ensureJob(jobMatch[1]);
        writeJson(res, 200, serializeJob(job));
        return;
      }

      const cancelMatch = pathname.match(/^\/jobs\/([^/]+)\/cancel$/);
      if (cancelMatch && req.method === 'POST') {
        const actorId = requireApiKey(req);
        const job = cancelJob(cancelMatch[1], actorId);
        writeJson(res, 200, serializeJob(job));
        return;
      }

      const retryMatch = pathname.match(/^\/jobs\/([^/]+)\/retry$/);
      if (retryMatch && req.method === 'POST') {
        const actorId = requireApiKey(req);
        const job = retryJob(retryMatch[1], actorId);
        writeJson(res, 202, serializeJob(job));
        return;
      }

      const logsMatch = pathname.match(/^\/jobs\/([^/]+)\/logs$/);
      if (logsMatch && req.method === 'GET') {
        requireApiKey(req);
        const job = ensureJob(logsMatch[1]);
        const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0);
        const limit = parseLimit(url.searchParams.get('limit'), 100, 500);
        const page = readJobLogs(job, offset, limit);
        writeJson(res, 200, {
          job_id: job.id,
          offset,
          limit,
          ...page,
        });
        return;
      }

      const artifactsMatch = pathname.match(/^\/jobs\/([^/]+)\/artifacts$/);
      if (artifactsMatch && req.method === 'GET') {
        requireApiKey(req);
        const job = ensureJob(artifactsMatch[1]);
        const artifactPath = url.searchParams.get('path');
        if (artifactPath === '__virtual__/git-diff.patch') {
          sendVirtualDiff(res, job);
          return;
        }

        writeJson(res, 200, {
          job_id: job.id,
          items: listJobArtifacts(job),
        });
        return;
      }

      if (
        pathname.startsWith('/runs/') &&
        pathname.endsWith('/stream') &&
        req.method === 'GET'
      ) {
        const parts = pathname.split('/');
        const runId = parts[2];
        const runtimeId =
          url.searchParams.get('runtime_id') ||
          CONTROL_PLANE_RUNTIME_ID ||
          DEFAULT_RUNTIME_ID;
        const agentId = url.searchParams.get('agent_id');
        const sessionId = url.searchParams.get('session_id');

        if (!agentId || !sessionId) {
          writeProtocolError(
            res,
            400,
            'input_error',
            'missing_scope',
            'runtime_id, agent_id, and session_id are required',
          );
          return;
        }

        const chatJid = buildHttpChatJid(runtimeId, agentId, sessionId);
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
          'X-Accel-Buffering': 'no',
        });
        res.write(
          `data: ${JSON.stringify({
            type: 'connected',
            chat_jid: chatJid,
            runtime_id: runtimeId,
            agent_id: agentId,
            session_id: sessionId,
            job_id: runId,
          })}\n\n`,
        );

        addClient(chatJid, res);
        const heartbeat = setInterval(() => {
          try {
            res.write(': ping\n\n');
          } catch {
            clearInterval(heartbeat);
          }
        }, 20_000);

        req.on('close', () => {
          clearInterval(heartbeat);
          removeClient(chatJid, res);
        });
        return;
      }

      if (pathname === '/runs' && req.method === 'POST') {
        const parsed = await readJsonBody(req);
        const {
          runtime_id: rawRuntimeId,
          agent_id: rawAgentId,
          session_id: rawSessionId,
          job_id: rawJobId,
          sender,
          sender_name,
          content,
        } = parsed;

        if (!content || typeof content !== 'string') {
          writeProtocolError(
            res,
            400,
            'input_error',
            'content_required',
            'content is required',
          );
          return;
        }

        const runtimeId =
          rawRuntimeId || CONTROL_PLANE_RUNTIME_ID || DEFAULT_RUNTIME_ID;
        const agentId =
          typeof rawAgentId === 'string' && rawAgentId.trim()
            ? rawAgentId.trim()
            : null;
        const sessionId =
          typeof rawSessionId === 'string' && rawSessionId.trim()
            ? rawSessionId.trim()
            : null;
        const jobId =
          typeof rawJobId === 'string' && rawJobId.trim()
            ? rawJobId.trim()
            : randomUUID();

        if (!agentId || !sessionId) {
          writeProtocolError(
            res,
            400,
            'input_error',
            'missing_scope',
            'runtime_id, agent_id, and session_id are required',
          );
          return;
        }

        const chatJid = buildHttpChatJid(runtimeId, agentId, sessionId);
        const senderId = sender || 'web-user';
        const senderName = sender_name || sender || 'Web User';
        const timestamp = new Date().toISOString();

        const enrollState = readEnrollmentState(
          CONTROL_PLANE_RUNTIME_ID || undefined,
        );
        if (enrollState.trust_state !== 'trusted') {
          writeJson(res, 403, {
            error: 'runtime_not_trusted',
            trust_state: enrollState.trust_state,
          });
          return;
        }

        const projects = this.opts.registeredProjects();
        if (!projects[chatJid] && this.opts.onGroupRegistered) {
          const group: RegisteredProject = {
            name: agentId,
            folder: safeAgentFolder(agentId),
            runtime_id: runtimeId,
            agent_id: agentId,
            trigger: '',
            added_at: timestamp,
            requiresTrigger: false,
            isMain: false,
          };
          this.opts.onGroupRegistered(chatJid, group);
        }

        ensureSession({
          runtime_id: runtimeId,
          agent_id: agentId,
          session_id: sessionId,
          chat_jid: chatJid,
          channel: 'http',
          agent_name: agentId,
          agent_folder: safeAgentFolder(agentId),
        });
        activeHttpJobs.set(chatJid, {
          runtime_id: runtimeId,
          agent_id: agentId,
          session_id: sessionId,
          job_id: jobId,
        });

        this.opts.onChatMetadata(chatJid, timestamp, undefined, 'http', false);

        const msg: NewMessage = {
          id: `web-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          chat_jid: chatJid,
          sender: senderId,
          sender_name: senderName,
          content,
          timestamp,
          is_from_me: false,
          runtime_id: runtimeId,
          agent_id: agentId,
          session_id: sessionId,
          job_id: jobId,
        };

        this.opts.onMessage(chatJid, msg);
        writeJson(res, 202, {
          ok: true,
          runtime_id: runtimeId,
          agent_id: agentId,
          session_id: sessionId,
          job_id: jobId,
          chat_jid: chatJid,
          id: msg.id,
        });
        return;
      }

      writeProtocolError(res, 404, 'input_error', 'not_found', 'Not found');
    } catch (err) {
      const protocolError = protocolErrorFromUnknown(err);
      logger.error({ err, pathname }, 'HTTP request failed');
      if (!res.headersSent) {
        writeProtocolError(
          res,
          protocolError.statusCode,
          protocolError.classification,
          protocolError.code,
          protocolError.message,
        );
      } else {
        res.end();
      }
    }
  }

  async sendMessage(
    jid: string,
    text: string,
    options?: { embeds?: any[] },
  ): Promise<void> {
    if (!text.trim()) return;
    const session = getSessionByChatJid(jid);
    const activeJob = activeHttpJobs.get(jid);
    broadcastToChat(jid, {
      type: 'message',
      chat_jid: jid,
      runtime_id: activeJob?.runtime_id || session?.runtime_id,
      agent_id: activeJob?.agent_id || session?.agent_id,
      session_id: activeJob?.session_id || session?.session_id,
      job_id: activeJob?.job_id,
      text,
      embeds: options?.embeds,
    });
    logger.info(
      {
        runtime_id: activeJob?.runtime_id || session?.runtime_id,
        agent_id: activeJob?.agent_id || session?.agent_id,
        session_id: activeJob?.session_id || session?.session_id,
        job_id: activeJob?.job_id,
        chat_jid: jid,
        length: text.length,
      },
      'HTTP SSE message broadcast',
    );
  }

  async sendFile(
    jid: string,
    _filePath: string,
    _caption?: string,
  ): Promise<void> {
    logger.warn({ jid }, 'HttpChannel.sendFile not implemented');
  }

  isConnected(): boolean {
    return this._connected && this.server !== null;
  }

  ownsJid(jid: string): boolean {
    return jid.startsWith(WEB_JID_PREFIX);
  }

  async disconnect(): Promise<void> {
    this._connected = false;
    if (this.server) {
      await new Promise<void>((resolve) => this.server!.close(() => resolve()));
      this.server = null;
    }
    for (const clients of sseClients.values()) {
      for (const res of clients) {
        try {
          res.end();
        } catch {
          /* ignore */
        }
      }
    }
    sseClients.clear();
    activeHttpJobs.clear();
    logger.info('HTTP SSE channel disconnected');
  }
}

function createHttpChannel(opts: ChannelOpts): HttpChannel | null {
  if (!HTTP_ENABLED) {
    logger.debug('HTTP channel disabled (HTTP_ENABLED=false)');
    return null;
  }
  return new HttpChannel(opts);
}

registerChannel('http', createHttpChannel);
