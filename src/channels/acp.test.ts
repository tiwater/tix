import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'events';

vi.mock('../core/config.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../core/config.js')>();
  const TICLAW_HOME = '/tmp/ticlaw-acp-test';
  return {
    ...actual,
    ACP_ENABLED: true,
    ACP_HUB_URL: '',
    AGENTS_DIR: `${TICLAW_HOME}/agents`,
    DATA_DIR: `${TICLAW_HOME}/data`,
    DEFAULT_RUNTIME_ID: 'runtime-1',
    HTTP_ENABLED: true,
    HTTP_PORT: 33981,
    RUNTIME_API_KEY: 'test-key',
    RUNTIME_CONCURRENCY_LIMIT: 10,
    STORE_DIR: `${TICLAW_HOME}/store`,
    TICLAW_HOME,
  };
});

import { _initTestDatabase, getSessionByScope } from '../core/db.js';
import type { RegisteredProject } from '../core/types.js';
import {
  AcpChannel,
  buildAcpChatJid,
  maybeHandleAcpRequest,
  normalizeAcpEnvelope,
  publishAcpJobEvent,
} from './acp.js';

class MockRequest extends EventEmitter {
  method: string;
  url: string;
  headers: Record<string, string>;
  private readonly body: string;

  constructor(input: {
    method: string;
    url: string;
    headers?: Record<string, string>;
    body?: string;
  }) {
    super();
    this.method = input.method;
    this.url = input.url;
    this.headers = input.headers || {};
    this.body = input.body || '';
  }

  setEncoding(): void {
    // no-op for tests
  }

  flushBody(): void {
    if (this.body) this.emit('data', this.body);
    this.emit('end');
  }
}

class MockResponse extends EventEmitter {
  statusCode = 200;
  headers: Record<string, string> = {};
  chunks: string[] = [];
  ended = false;

  setHeader(name: string, value: string): void {
    this.headers[name] = value;
  }

  writeHead(statusCode: number, headers?: Record<string, string>): this {
    this.statusCode = statusCode;
    if (headers) {
      Object.assign(this.headers, headers);
    }
    return this;
  }

  write(chunk: string): boolean {
    this.chunks.push(String(chunk));
    return true;
  }

  end(chunk?: string): this {
    if (chunk) this.write(chunk);
    this.ended = true;
    return this;
  }

  json(): any {
    return JSON.parse(this.chunks.join(''));
  }
}

async function callAcpRoute(input: {
  method: string;
  path: string;
  headers?: Record<string, string>;
  body?: unknown;
}): Promise<MockResponse> {
  const body =
    input.body === undefined ? undefined : JSON.stringify(input.body);
  const req = new MockRequest({
    method: input.method,
    url: input.path,
    headers: input.headers,
    body,
  });
  const res = new MockResponse();
  const handledPromise = maybeHandleAcpRequest(
    req as any,
    res as any,
    new URL(`http://localhost${input.path}`),
  );
  req.flushBody();
  await handledPromise;
  return res;
}

describe('ACP channel', () => {
  let acpChannel: AcpChannel;
  let projects: Record<string, RegisteredProject>;

  beforeEach(async () => {
    _initTestDatabase();
    projects = {};

    const opts = {
      onMessage: vi.fn(),
      onChatMetadata: vi.fn(),
      registeredProjects: () => projects,
      onGroupRegistered: (jid: string, group: RegisteredProject) => {
        projects[jid] = group;
      },
    };

    acpChannel = new AcpChannel(opts as any);
    await acpChannel.connect();
  });

  afterEach(async () => {
    await acpChannel.disconnect();
  });

  it('normalizes ACP envelopes with text and tool calls', () => {
    const envelope = normalizeAcpEnvelope({
      role: 'user',
      content: 'hello',
      tool_calls: [{ name: 'Read', arguments: { path: 'README.md' } }],
    });

    expect(envelope.role).toBe('user');
    expect(envelope.content).toEqual([{ type: 'text', text: 'hello' }]);
    expect(envelope.tool_calls?.[0]?.name).toBe('Read');
    expect(envelope.tool_calls?.[0]?.arguments).toEqual({
      path: 'README.md',
    });
  });

  it('creates ACP sessions and queues jobs through the HTTP server', async () => {
    const createdResponse = await callAcpRoute({
      method: 'POST',
      path: '/acp/sessions',
      headers: {
        authorization: 'Bearer test-key',
      },
      body: {
        runtime_id: 'runtime-1',
        agent_id: 'agent-1',
        session_id: 'thread-1',
      },
    });

    expect(createdResponse.statusCode).toBe(201);
    const created = createdResponse.json();
    expect(created.session.session_id).toBe('thread-1');

    const messageResponse = await callAcpRoute({
      method: 'POST',
      path: created.session.message_url,
      headers: {
        authorization: 'Bearer test-key',
      },
      body: {
        role: 'user',
        content: [
          { type: 'markdown', text: 'Solve this via ACP.' },
          {
            type: 'artifact',
            name: 'spec.md',
            path: '/tmp/spec.md',
          },
        ],
      },
    });
    expect(messageResponse.statusCode).toBe(202);
    const queued = messageResponse.json();
    expect(queued.job_id).toBeTruthy();

    const sessionRecord = getSessionByScope('runtime-1', 'agent-1', 'thread-1');
    expect(sessionRecord?.chat_jid).toBe(
      buildAcpChatJid('runtime-1', 'agent-1', 'thread-1'),
    );

    const sessionResponse = await callAcpRoute({
      method: 'GET',
      path: created.session.message_url,
      headers: {
        authorization: 'Bearer test-key',
      },
    });

    expect(sessionResponse.statusCode).toBe(200);
    const sessionPayload = sessionResponse.json();
    expect(sessionPayload.session.last_job_id).toBe(queued.job_id);
    expect(sessionPayload.messages).toHaveLength(1);
    expect(sessionPayload.messages[0].content[0].type).toBe('markdown');
  });

  it('streams ACP SSE events for tool calls and assistant replies', async () => {
    const createdResponse = await callAcpRoute({
      method: 'POST',
      path: '/acp/sessions',
      headers: {
        authorization: 'Bearer test-key',
      },
      body: {
        runtime_id: 'runtime-1',
        agent_id: 'agent-1',
        session_id: 'thread-sse',
      },
    });
    const created = createdResponse.json();

    const req = new MockRequest({
      method: 'GET',
      url: created.session.stream_url,
      headers: {
        authorization: 'Bearer test-key',
        accept: 'text/event-stream',
      },
    });
    const res = new MockResponse();
    const streamPromise = maybeHandleAcpRequest(
      req as any,
      res as any,
      new URL(`http://localhost${created.session.stream_url}`),
    );
    req.flushBody();
    await streamPromise;

    const initialChunk = res.chunks.join('');
    expect(initialChunk).toContain('"type":"session"');

    await publishAcpJobEvent(created.session.chat_jid, {
      phase: 'tool_call',
      tool_calls: [
        { id: 'tool-1', name: 'Read', arguments: { path: 'README.md' } },
      ],
    });
    await acpChannel.sendMessage(created.session.chat_jid, 'Final ACP reply');

    const streamedChunk = res.chunks.join('');
    expect(streamedChunk).toContain('"type":"tool_call"');
    expect(streamedChunk).toContain('Final ACP reply');

    req.emit('close');
  });
});
