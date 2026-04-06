import fs from 'fs';
import http from 'http';
import path from 'path';
import { randomUUID } from 'crypto';

import { ACP_ENABLED, ACP_RELAY_URL } from '../core/config.js';
import { ensureSession } from '../core/store.js';
import { logger } from '../core/logger.js';
import { validateOutboundEndpoint } from '../core/security.js';
import { submitTask } from '../task-executor.js';
import { ACPClient } from '../acp-client.js';
import type {
  ACPAgentManifest,
  ACPArtifactContentPart,
  ACPContentPart,
  ACPMessageEnvelope,
  ACPSessionDescriptor,
  ACPStreamEvent,
  ACPToolCall,
  ACPToolResult,
} from '../acp-types.js';
import type { Channel, RegisteredProject } from '../core/types.js';
import { registerChannel, type ChannelOpts } from './registry.js';

const ACP_JID_PREFIX = 'acp:';
const MAX_SESSION_MESSAGES = 200;

interface ACPSessionState extends ACPSessionDescriptor {
  metadata?: Record<string, unknown>;
  messages: ACPMessageEnvelope[];
  clients: Set<http.ServerResponse>;
  last_task_id?: string;
  relay_session_id?: string;
  relay_sync_started?: boolean;
  relay_abort?: AbortController;
}

let runtimeOpts: ChannelOpts | null = null;
let defaultClient: ACPClient | null = null;

const sessionsById = new Map<string, ACPSessionState>();
const sessionIdByChatJid = new Map<string, string>();

function nowIso(): string {
  return new Date().toISOString();
}

function buildThreadId(agentId: string, sessionId: string): string {
  return `${encodeURIComponent(agentId)}:${encodeURIComponent(sessionId)}`;
}

function parseThreadId(
  threadId: string,
): { agent_id: string; session_id: string } | null {
  const parts = threadId.split(':');
  if (parts.length < 2) return null;
  try {
    return {
      agent_id: decodeURIComponent(parts[0]),
      session_id: decodeURIComponent(parts[1]),
    };
  } catch {
    return null;
  }
}

export function buildAcpChatJid(agentId: string, sessionId: string): string {
  return `${ACP_JID_PREFIX}${buildThreadId(agentId, sessionId)}`;
}

function readJsonBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.setEncoding('utf-8');
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      if (!body.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function writeJson(
  res: http.ServerResponse,
  statusCode: number,
  payload: unknown,
): void {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
  });
  res.end(JSON.stringify(payload));
}

function writeProtocolError(
  res: http.ServerResponse,
  statusCode: number,
  code: string,
  message: string,
  details?: Record<string, unknown>,
): void {
  writeJson(res, statusCode, {
    error: {
      code,
      message,
      ...(details ? { details } : {}),
    },
  });
}

function wantsSse(req: http.IncomingMessage, url: URL): boolean {
  if (url.searchParams.get('stream') === '1') return true;
  const accept = req.headers.accept;
  return typeof accept === 'string' && accept.includes('text/event-stream');
}

function inferMimeType(filePath: string): string | undefined {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.md') return 'text/markdown';
  if (ext === '.txt' || ext === '.log' || ext === '.jsonl') return 'text/plain';
  if (ext === '.json') return 'application/json';
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.pdf') return 'application/pdf';
  return undefined;
}

function normalizeContentPart(part: unknown): ACPContentPart | null {
  if (!part) return null;
  if (typeof part === 'string') {
    return { type: 'text', text: part };
  }
  if (typeof part !== 'object') return null;

  const value = part as Record<string, unknown>;
  const type = value.type;
  if (
    (type === 'text' || type === 'markdown') &&
    typeof value.text === 'string'
  ) {
    return { type, text: value.text };
  }
  if (type === 'artifact') {
    return {
      type: 'artifact',
      name: typeof value.name === 'string' ? value.name : undefined,
      mime_type:
        typeof value.mime_type === 'string' ? value.mime_type : undefined,
      uri: typeof value.uri === 'string' ? value.uri : undefined,
      path: typeof value.path === 'string' ? value.path : undefined,
      description:
        typeof value.description === 'string' ? value.description : undefined,
      data: typeof value.data === 'string' ? value.data : undefined,
    };
  }
  return null;
}

function normalizeContent(content: unknown): ACPContentPart[] {
  if (typeof content === 'string') {
    return content.trim() ? [{ type: 'text', text: content }] : [];
  }
  if (Array.isArray(content)) {
    return content
      .map((part) => normalizeContentPart(part))
      .filter((part): part is ACPContentPart => !!part);
  }
  if (content && typeof content === 'object') {
    const single = normalizeContentPart(content);
    return single ? [single] : [];
  }
  return [];
}

function normalizeToolCall(toolCall: unknown): ACPToolCall | null {
  if (!toolCall || typeof toolCall !== 'object') return null;
  const value = toolCall as Record<string, unknown>;
  const name =
    typeof value.name === 'string'
      ? value.name
      : typeof value.tool_name === 'string'
        ? value.tool_name
        : null;
  if (!name) return null;
  return {
    id:
      typeof value.id === 'string' && value.id
        ? value.id
        : typeof value.tool_call_id === 'string' && value.tool_call_id
          ? value.tool_call_id
          : randomUUID(),
    name,
    arguments:
      value.arguments && typeof value.arguments === 'object'
        ? (value.arguments as Record<string, unknown>)
        : value.input && typeof value.input === 'object'
          ? (value.input as Record<string, unknown>)
          : undefined,
  };
}

function normalizeToolResult(toolResult: unknown): ACPToolResult | null {
  if (!toolResult || typeof toolResult !== 'object') return null;
  const value = toolResult as Record<string, unknown>;
  const toolCallId =
    typeof value.tool_call_id === 'string'
      ? value.tool_call_id
      : typeof value.id === 'string'
        ? value.id
        : null;
  if (!toolCallId) return null;
  return {
    tool_call_id: toolCallId,
    name: typeof value.name === 'string' ? value.name : undefined,
    result: value.result ?? value.output ?? value.content,
    is_error:
      typeof value.is_error === 'boolean'
        ? value.is_error
        : typeof value.error === 'boolean'
          ? value.error
          : false,
  };
}

export function normalizeAcpEnvelope(
  input: unknown,
  fallbackRole: ACPMessageEnvelope['role'] = 'user',
): ACPMessageEnvelope {
  const raw =
    input && typeof input === 'object' && 'message' in (input as any)
      ? (input as any).message
      : input;
  const value =
    raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const role =
    value.role === 'system' ||
    value.role === 'user' ||
    value.role === 'assistant' ||
    value.role === 'tool'
      ? value.role
      : fallbackRole;

  const content = normalizeContent(
    value.content ?? value.parts ?? value.text ?? value.prompt ?? '',
  );
  const toolCalls = Array.isArray(value.tool_calls)
    ? value.tool_calls
        .map((toolCall) => normalizeToolCall(toolCall))
        .filter((toolCall): toolCall is ACPToolCall => !!toolCall)
    : [];
  const toolResults = Array.isArray(value.tool_results)
    ? value.tool_results
        .map((toolResult) => normalizeToolResult(toolResult))
        .filter((toolResult): toolResult is ACPToolResult => !!toolResult)
    : [];

  return {
    id: typeof value.id === 'string' && value.id ? value.id : randomUUID(),
    role,
    content,
    ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
    ...(toolResults.length ? { tool_results: toolResults } : {}),
    ...(value.metadata && typeof value.metadata === 'object'
      ? { metadata: value.metadata as Record<string, unknown> }
      : {}),
    created_at:
      typeof value.created_at === 'string' && value.created_at
        ? value.created_at
        : nowIso(),
  };
}

function renderContentForPrompt(content: ACPContentPart[]): string {
  return content
    .map((part) => {
      if (part.type === 'artifact') {
        return [
          '[Artifact]',
          part.name ? `name: ${part.name}` : null,
          part.path ? `path: ${part.path}` : null,
          part.uri ? `uri: ${part.uri}` : null,
          part.description ? `description: ${part.description}` : null,
        ]
          .filter(Boolean)
          .join('\n');
      }
      return part.text;
    })
    .filter(Boolean)
    .join('\n\n');
}

function buildPromptFromEnvelope(
  envelope: ACPMessageEnvelope,
  mode: 'message' | 'tools' = 'message',
): string {
  const parts: string[] = [];

  if (mode === 'tools' && envelope.tool_calls?.length) {
    parts.push(
      'Execute the requested tool calls and return the results clearly. Include any errors inline.',
    );
  } else {
    parts.push(`ACP ${envelope.role} message:`);
  }

  const renderedContent = renderContentForPrompt(envelope.content);
  if (renderedContent) parts.push(renderedContent);

  if (envelope.tool_calls?.length) {
    parts.push(
      `[ACP tool calls]\n${JSON.stringify(envelope.tool_calls, null, 2)}`,
    );
  }
  if (envelope.tool_results?.length) {
    parts.push(
      `[ACP tool results]\n${JSON.stringify(envelope.tool_results, null, 2)}`,
    );
  }

  return parts.join('\n\n').trim();
}

function isExecutableEnvelope(envelope: ACPMessageEnvelope): boolean {
  if (envelope.tool_calls?.length) return true;
  return envelope.content.some((part) =>
    part.type === 'artifact' ? true : !!part.text.trim(),
  );
}

function serializeSession(session: ACPSessionState): Record<string, unknown> {
  return {
    id: session.id,
    thread_id: session.thread_id,
    agent_id: session.agent_id,
    session_id: session.session_id,
    chat_jid: session.chat_jid,
    created_at: session.created_at,
    updated_at: session.updated_at,
    stream_url: session.stream_url,
    message_url: session.message_url,
    tools_url: session.tools_url,
    last_task_id: session.last_task_id || null,
    metadata: session.metadata || null,
  };
}

function writeSseEvent(
  res: http.ServerResponse,
  event: ACPStreamEvent,
  eventName?: string,
): void {
  if (eventName) {
    res.write(`event: ${eventName}\n`);
  }
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

function broadcastSessionEvent(
  session: ACPSessionState,
  event: ACPStreamEvent,
  eventName?: string,
): void {
  for (const client of [...session.clients]) {
    try {
      writeSseEvent(client, event, eventName);
    } catch {
      session.clients.delete(client);
    }
  }
}

function appendMessage(
  session: ACPSessionState,
  envelope: ACPMessageEnvelope,
): void {
  session.messages.push(envelope);
  if (session.messages.length > MAX_SESSION_MESSAGES) {
    session.messages.splice(0, session.messages.length - MAX_SESSION_MESSAGES);
  }
  session.updated_at = nowIso();
}

function listAgentManifests(): ACPAgentManifest[] {
  const opts = runtimeOpts;
  const uniqueAgents = new Map<string, string>();

  for (const project of Object.values(opts?.registeredProjects() || {})) {
    const agentId = project.agent_id || project.folder;
    uniqueAgents.set(agentId, agentId);
  }

  if (uniqueAgents.size === 0) {
    uniqueAgents.set('default', 'default');
  }

  return [...uniqueAgents.keys()].map((agentId) => ({
    id: buildThreadId(agentId, agentId),
    protocol: 'acp',
    name: `Tix ${agentId}`,
    description: 'Tix ACP-compatible agent endpoint',
    version: '1.0.0',
    agent_id: agentId,
    endpoints: {
      agents: '/acp/agents',
      sessions: '/acp/sessions',
    },
    capabilities: {
      streaming: true,
      inbound: true,
      outbound: true,
      tool_calls: true,
      tool_results: true,
      content_types: ['text', 'markdown', 'artifact'],
    },
  }));
}

function ensureRegisteredProject(
  agentId: string,
  chatJid: string,
  timestamp: string,
): void {
  const opts = runtimeOpts;
  if (!opts) return;
  const projects = opts.registeredProjects();
  if (!projects[chatJid] && opts.onGroupRegistered) {
    const project: RegisteredProject = {
      name: agentId,
      folder: agentId,
      agent_id: agentId,
      trigger: '',
      added_at: timestamp,
      requiresTrigger: false,
      isMain: false,
    };
    opts.onGroupRegistered(chatJid, project);
  }
  opts.onChatMetadata(chatJid, timestamp, undefined, 'acp', false);
}

function ensureRelayMirror(session: ACPSessionState): void {
  if (!defaultClient || session.relay_sync_started) return;
  session.relay_sync_started = true;

  void defaultClient
    .createSession({
      agent_id: session.agent_id,
      session_id: session.session_id,
      thread_id: session.thread_id,
      metadata: {
        origin: 'tix',
        local_session_id: session.id,
      },
    })
    .then(({ session: remoteSession }) => {
      session.relay_session_id = remoteSession.id;
      session.relay_abort = new AbortController();
      return defaultClient!.streamSession(
        remoteSession.id,
        {
          onEvent: async (event) => {
            await handleRelayEvent(session, event);
          },
        },
        session.relay_abort.signal,
      );
    })
    .catch((err) => {
      logger.warn(
        { err, session_id: session.id, relay_url: ACP_RELAY_URL },
        'ACP relay mirror unavailable',
      );
    });
}

async function mirrorEnvelopeToRelay(
  session: ACPSessionState,
  envelope: ACPMessageEnvelope,
): Promise<void> {
  if (!defaultClient || !session.relay_session_id) return;
  try {
    await defaultClient.sendMessage(session.relay_session_id, {
      message: {
        ...envelope,
        metadata: {
          ...(envelope.metadata || {}),
          origin: 'tix',
          local_session_id: session.id,
        },
      },
    });
  } catch (err) {
    logger.warn(
      { err, session_id: session.id },
      'Failed to mirror ACP message',
    );
  }
}

async function mirrorToolCallsToRelay(
  session: ACPSessionState,
  toolCalls: ACPToolCall[],
): Promise<void> {
  if (!defaultClient || !session.relay_session_id || toolCalls.length === 0)
    return;
  try {
    await defaultClient.sendToolCalls(session.relay_session_id, {
      tool_calls: toolCalls,
      metadata: {
        origin: 'tix',
        local_session_id: session.id,
      },
    });
  } catch (err) {
    logger.warn(
      { err, session_id: session.id },
      'Failed to mirror ACP tool calls',
    );
  }
}

async function handleRelayEvent(
  session: ACPSessionState,
  event: ACPStreamEvent,
): Promise<void> {
  const origin =
    event.message?.metadata && typeof event.message.metadata.origin === 'string'
      ? event.message.metadata.origin
      : undefined;
  if (origin === 'tix') return;

  if (event.type === 'message' && event.message) {
    appendMessage(session, event.message);
    broadcastSessionEvent(session, {
      type: 'message',
      session_id: session.id,
      task_id: session.last_task_id,
      message: event.message,
    });

    if (
      event.message.role !== 'assistant' ||
      event.message.tool_calls?.length
    ) {
      await submitEnvelope(session, event.message, 'acp-relay', 'message', false);
    }
    return;
  }

  if (event.type === 'tool_call' && event.tool_calls?.length) {
    const envelope: ACPMessageEnvelope = {
      id: randomUUID(),
      role: 'user',
      content: [],
      tool_calls: event.tool_calls,
      created_at: nowIso(),
      metadata: { origin: 'acp-relay' },
    };
    await submitEnvelope(session, envelope, 'acp-relay', 'tools', false);
    return;
  }

  if (event.type === 'tool_result' && event.tool_results?.length) {
    const envelope: ACPMessageEnvelope = {
      id: randomUUID(),
      role: 'tool',
      content: [],
      tool_results: event.tool_results,
      created_at: nowIso(),
      metadata: { origin: 'acp-relay' },
    };
    appendMessage(session, envelope);
    broadcastSessionEvent(session, {
      type: 'tool_result',
      session_id: session.id,
      task_id: session.last_task_id,
      tool_results: event.tool_results,
      message: envelope,
    });
  }
}

function ensureAcpSessionState(input: {
  agent_id: string;
  session_id?: string;
  thread_id?: string;
  metadata?: Record<string, unknown>;
}): ACPSessionState {
  const parsedThread = input.thread_id ? parseThreadId(input.thread_id) : null;
  const agentId = parsedThread?.agent_id || input.agent_id;
  const sessionId =
    parsedThread?.session_id ||
    input.session_id ||
    input.thread_id ||
    randomUUID();
  const threadId = buildThreadId(agentId, sessionId);

  const existing = sessionsById.get(threadId);
  if (existing) {
    if (input.metadata) {
      existing.metadata = {
        ...(existing.metadata || {}),
        ...input.metadata,
      };
    }
    existing.updated_at = nowIso();
    return existing;
  }

  const chatJid = buildAcpChatJid(agentId, sessionId);
  const timestamp = nowIso();

  ensureRegisteredProject(agentId, chatJid, timestamp);
  ensureSession({
    agent_id: agentId,
    session_id: sessionId,
    channel: 'acp',
    agent_name: agentId,
  });

  const session: ACPSessionState = {
    id: threadId,
    thread_id: threadId,
    agent_id: agentId,
    session_id: sessionId,
    chat_jid: chatJid,
    created_at: timestamp,
    updated_at: timestamp,
    stream_url: `/acp/sessions/${encodeURIComponent(threadId)}?stream=1`,
    message_url: `/acp/sessions/${encodeURIComponent(threadId)}`,
    tools_url: `/acp/sessions/${encodeURIComponent(threadId)}/tools`,
    metadata: input.metadata,
    messages: [],
    clients: new Set(),
  };

  sessionsById.set(threadId, session);
  sessionIdByChatJid.set(chatJid, threadId);
  ensureRelayMirror(session);
  return session;
}

function getSessionByRouteId(id: string): ACPSessionState | null {
  const decoded = decodeURIComponent(id);
  const existing = sessionsById.get(decoded);
  if (existing) return existing;

  const parsed = parseThreadId(decoded);
  if (!parsed) return null;
  return ensureAcpSessionState(parsed);
}

async function submitEnvelope(
  session: ACPSessionState,
  envelope: ACPMessageEnvelope,
  actorId: string,
  mode: 'message' | 'tools' = 'message',
  mirrorToHub = true,
): Promise<{
  accepted: boolean;
  task_id?: string;
}> {
  appendMessage(session, envelope);
  broadcastSessionEvent(session, {
    type: 'message',
    session_id: session.id,
    task_id: session.last_task_id,
    message: envelope,
  });

  if (mirrorToHub) {
    await mirrorEnvelopeToRelay(session, envelope);
  }

  if (!isExecutableEnvelope(envelope)) {
    return { accepted: false };
  }

  const task = submitTask({
    agent_id: session.agent_id,
    session_id: session.session_id,
    prompt: buildPromptFromEnvelope(envelope, mode),
    source: 'acp',
    submitted_by: actorId,
    submitter_type: 'api_key',
    metadata: {
      protocol: 'acp',
      mode,
      envelope,
    },
  });

  session.last_task_id = task.id;
  session.updated_at = nowIso();
  broadcastSessionEvent(session, {
    type: 'task',
    session_id: session.id,
    task_id: task.id,
    data: {
      phase: 'queued',
      agent_id: session.agent_id,
      session_id: session.session_id,
    },
  });

  return {
    accepted: true,
    task_id: task.id,
  };
}

export async function publishAcpTaskEvent(
  chatJid: string,
  event: Record<string, unknown>,
): Promise<void> {
  const sessionId = sessionIdByChatJid.get(chatJid);
  if (!sessionId) return;
  const session = sessionsById.get(sessionId);
  if (!session) return;

  const phase = typeof event.phase === 'string' ? event.phase : 'activity';
  const payload: ACPStreamEvent = {
    type: 'task',
    session_id: session.id,
    task_id:
      typeof event.task_id === 'string' ? event.task_id : session.last_task_id,
    data: event,
  };

  if (phase === 'message_delta') {
    broadcastSessionEvent(session, {
      type: 'message.delta',
      session_id: session.id,
      task_id: payload.task_id,
      data: event,
    });
    return;
  }

  if (phase === 'tool_call' && Array.isArray(event.tool_calls)) {
    const toolCalls = event.tool_calls as ACPToolCall[];
    broadcastSessionEvent(session, {
      type: 'tool_call',
      session_id: session.id,
      task_id: payload.task_id,
      tool_calls: toolCalls,
      data: event,
    });
    await mirrorToolCallsToRelay(session, toolCalls);
    return;
  }

  if (phase === 'tool_result' && Array.isArray(event.tool_results)) {
    broadcastSessionEvent(session, {
      type: 'tool_result',
      session_id: session.id,
      task_id: payload.task_id,
      tool_results: event.tool_results as ACPToolResult[],
      data: event,
    });
    return;
  }

  if (phase === 'failed' || phase === 'timeout' || phase === 'canceled') {
    broadcastSessionEvent(session, {
      type: 'error',
      session_id: session.id,
      task_id: payload.task_id,
      error: {
        code:
          event.error &&
          typeof event.error === 'object' &&
          typeof (event.error as Record<string, unknown>).code === 'string'
            ? ((event.error as Record<string, unknown>).code as string)
            : phase,
        message:
          event.error &&
          typeof event.error === 'object' &&
          typeof (event.error as Record<string, unknown>).message === 'string'
            ? ((event.error as Record<string, unknown>).message as string)
            : `Task ${phase}`,
      },
      data: event,
    });
    return;
  }

  broadcastSessionEvent(session, payload);
}

export async function maybeHandleAcpRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: URL,
): Promise<boolean> {
  if (!url.pathname.startsWith('/acp')) return false;

  if (!ACP_ENABLED) {
    writeProtocolError(res, 503, 'acp_disabled', 'ACP channel is disabled');
    return true;
  }

  try {
    if (url.pathname === '/acp/agents' && req.method === 'GET') {
      writeJson(res, 200, {
        protocol: 'acp',
        agents: listAgentManifests(),
      });
      return true;
    }

    if (url.pathname === '/acp/sessions' && req.method === 'POST') {
      const parsed = await readJsonBody(req);
      const agentId =
        typeof parsed.agent_id === 'string' && parsed.agent_id.trim()
          ? parsed.agent_id.trim()
          : '';
      if (!agentId) {
        writeProtocolError(
          res,
          400,
          'agent_id_required',
          'agent_id is required',
        );
        return true;
      }

      const session = ensureAcpSessionState({
        agent_id: agentId,
        session_id:
          typeof parsed.session_id === 'string' ? parsed.session_id : undefined,
        thread_id:
          typeof parsed.thread_id === 'string' ? parsed.thread_id : undefined,
        metadata:
          parsed.metadata && typeof parsed.metadata === 'object'
            ? parsed.metadata
            : undefined,
      });

      let taskId: string | undefined;
      if (parsed.message) {
        const envelope = normalizeAcpEnvelope(parsed.message);
        const result = await submitEnvelope(session, envelope, 'acp');
        taskId = result.task_id;
      }

      writeJson(res, taskId ? 202 : 201, {
        session: serializeSession(session),
        task_id: taskId || null,
      });
      return true;
    }

    const sessionToolsMatch = url.pathname.match(
      /^\/acp\/sessions\/([^/]+)\/tools$/,
    );
    if (sessionToolsMatch && req.method === 'POST') {
      const session = getSessionByRouteId(sessionToolsMatch[1]);
      if (!session) {
        writeProtocolError(
          res,
          404,
          'session_not_found',
          'ACP session not found',
        );
        return true;
      }

      const parsed = await readJsonBody(req);
      const toolCalls = Array.isArray(parsed.tool_calls)
        ? parsed.tool_calls
            .map((toolCall: unknown) => normalizeToolCall(toolCall))
            .filter(
              (toolCall: ACPToolCall | null): toolCall is ACPToolCall =>
                !!toolCall,
            )
        : [];

      if (toolCalls.length === 0) {
        writeProtocolError(
          res,
          400,
          'tool_calls_required',
          'tool_calls must contain at least one tool call',
        );
        return true;
      }

      const envelope: ACPMessageEnvelope = {
        id: randomUUID(),
        role: 'user',
        content: normalizeContent(parsed.content ?? parsed.prompt ?? ''),
        tool_calls: toolCalls,
        created_at: nowIso(),
        ...(parsed.metadata && typeof parsed.metadata === 'object'
          ? { metadata: parsed.metadata as Record<string, unknown> }
          : {}),
      };

      const result = await submitEnvelope(session, envelope, 'acp', 'tools');
      writeJson(res, 202, {
        session: serializeSession(session),
        task_id: result.task_id || null,
        message: envelope,
      });
      return true;
    }

    const sessionMatch = url.pathname.match(/^\/acp\/sessions\/([^/]+)$/);
    if (sessionMatch) {
      const session = getSessionByRouteId(sessionMatch[1]);
      if (!session) {
        writeProtocolError(
          res,
          404,
          'session_not_found',
          'ACP session not found',
        );
        return true;
      }

      if (req.method === 'GET') {
        if (wantsSse(req, url)) {
          res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
            'X-Accel-Buffering': 'no',
          });

          session.clients.add(res);
          writeSseEvent(
            res,
            {
              type: 'session',
              session_id: session.id,
              task_id: session.last_task_id,
              data: {
                session: serializeSession(session),
                messages: session.messages.slice(-20),
              },
            },
            'session',
          );

          const heartbeat = setInterval(() => {
            try {
              res.write(': ping\n\n');
            } catch {
              clearInterval(heartbeat);
            }
          }, 20_000);

          req.on('close', () => {
            clearInterval(heartbeat);
            session.clients.delete(res);
          });
          return true;
        }

        writeJson(res, 200, {
          session: serializeSession(session),
          messages: session.messages,
        });
        return true;
      }

      if (req.method === 'POST') {
        const parsed = await readJsonBody(req);
        const envelope = normalizeAcpEnvelope(parsed, 'user');
        const result = await submitEnvelope(session, envelope, 'acp');
        writeJson(res, result.task_id ? 202 : 200, {
          session: serializeSession(session),
          task_id: result.task_id || null,
          message: envelope,
        });
        return true;
      }
    }
  } catch (err) {
    const statusCode =
      err && typeof err === 'object' && 'statusCode' in err
        ? Number((err as any).statusCode) || 500
        : 500;
    const code =
      err && typeof err === 'object' && 'code' in err
        ? String((err as any).code)
        : 'internal_error';
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err, pathname: url.pathname }, 'ACP request failed');
    writeProtocolError(res, statusCode, code, message);
    return true;
  }

  return false;
}

export class AcpChannel implements Channel {
  name = 'acp';

  private readonly opts: ChannelOpts;
  private connected = false;

  constructor(opts: ChannelOpts) {
    this.opts = opts;
    runtimeOpts = opts;
    if (ACP_RELAY_URL) {
      try {
        const trustedEndpoint = validateOutboundEndpoint(ACP_RELAY_URL, {
          allowedProtocols: ['http:', 'https:'],
          label: 'ACP_RELAY_URL',
        });
        defaultClient = new ACPClient({
          baseUrl: trustedEndpoint.toString(),
        });
      } catch (err: any) {
        logger.error(
          { err: err.message, acp_relay_url: ACP_RELAY_URL },
          'ACP channel disabled remote sync due to endpoint security policy',
        );
        defaultClient = null;
      }
    }
  }

  async connect(): Promise<void> {
    this.connected = true;
    logger.info(
      {
        relay_url: ACP_RELAY_URL || null,
      },
      'ACP channel ready',
    );
  }

  async sendMessage(
    jid: string,
    text: string,
    _options?: { embeds?: any[] },
  ): Promise<void> {
    const sessionId = sessionIdByChatJid.get(jid);
    if (!sessionId) return;
    const session = sessionsById.get(sessionId);
    if (!session || !text.trim()) return;

    const envelope: ACPMessageEnvelope = {
      id: randomUUID(),
      role: 'assistant',
      content: [{ type: 'markdown', text }],
      created_at: nowIso(),
    };

    appendMessage(session, envelope);
    broadcastSessionEvent(session, {
      type: 'message',
      session_id: session.id,
      task_id: session.last_task_id,
      message: envelope,
    });
    await mirrorEnvelopeToRelay(session, envelope);
  }

  async sendFile(
    jid: string,
    filePath: string,
    caption?: string,
  ): Promise<void> {
    const sessionId = sessionIdByChatJid.get(jid);
    if (!sessionId) return;
    const session = sessionsById.get(sessionId);
    if (!session) return;

    const artifactPart: ACPArtifactContentPart = {
      type: 'artifact',
      name: path.basename(filePath),
      path: filePath,
      mime_type: inferMimeType(filePath),
      description: caption,
    };

    if (fs.existsSync(filePath)) {
      artifactPart.uri = filePath;
    }

    const envelope: ACPMessageEnvelope = {
      id: randomUUID(),
      role: 'assistant',
      content: [
        ...(caption ? [{ type: 'markdown' as const, text: caption }] : []),
        artifactPart,
      ],
      created_at: nowIso(),
    };

    appendMessage(session, envelope);
    broadcastSessionEvent(session, {
      type: 'message',
      session_id: session.id,
      task_id: session.last_task_id,
      message: envelope,
    });
    await mirrorEnvelopeToRelay(session, envelope);
  }

  isConnected(): boolean {
    return this.connected;
  }

  ownsJid(jid: string): boolean {
    return jid.startsWith(ACP_JID_PREFIX);
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    for (const session of sessionsById.values()) {
      session.relay_abort?.abort();
      for (const client of session.clients) {
        try {
          client.end();
        } catch {
          /* ignore */
        }
      }
      session.clients.clear();
    }
    logger.info('ACP channel disconnected');
  }
}

function createAcpChannel(opts: ChannelOpts): AcpChannel | null {
  if (!ACP_ENABLED) {
    logger.debug('ACP channel disabled (ACP_ENABLED=false)');
    return null;
  }
  return new AcpChannel(opts);
}

registerChannel('acp', createAcpChannel);
