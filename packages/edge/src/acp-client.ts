import type {
  ACPAgentManifest,
  ACPCreateSessionRequest,
  ACPSendMessageRequest,
  ACPSessionDescriptor,
  ACPStreamEvent,
  ACPToolCallRequest,
} from './acp-types.js';

interface SSEFrame {
  event?: string;
  data?: string;
  id?: string;
  retry?: number;
}

export interface ACPStreamHandlers {
  onEvent?: (event: ACPStreamEvent) => Promise<void> | void;
  onMessage?: (event: ACPStreamEvent) => Promise<void> | void;
  onToolCall?: (event: ACPStreamEvent) => Promise<void> | void;
  onToolResult?: (event: ACPStreamEvent) => Promise<void> | void;
}

export interface ACPClientOptions {
  baseUrl: string;
  apiKey?: string;
  fetchImpl?: typeof fetch;
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '');
}

function buildSSEFrames(chunkBuffer: string): {
  frames: SSEFrame[];
  remainder: string;
} {
  const normalized = chunkBuffer.replace(/\r\n/g, '\n');
  const segments = normalized.split('\n\n');
  const remainder = normalized.endsWith('\n\n') ? '' : (segments.pop() ?? '');
  const frames = segments
    .map((segment) => {
      const frame: SSEFrame = {};
      for (const line of segment.split('\n')) {
        if (!line || line.startsWith(':')) continue;
        const idx = line.indexOf(':');
        const field = idx === -1 ? line : line.slice(0, idx);
        const rawValue = idx === -1 ? '' : line.slice(idx + 1).trimStart();
        if (field === 'event') frame.event = rawValue;
        if (field === 'data') {
          frame.data = frame.data ? `${frame.data}\n${rawValue}` : rawValue;
        }
        if (field === 'id') frame.id = rawValue;
        if (field === 'retry') {
          const retry = Number(rawValue);
          if (Number.isFinite(retry)) frame.retry = retry;
        }
      }
      return frame;
    })
    .filter((frame) => frame.data || frame.event || frame.id);

  return { frames, remainder };
}

export async function* parseSSE(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<SSEFrame> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const { frames, remainder } = buildSSEFrames(buffer);
    buffer = remainder;

    for (const frame of frames) {
      yield frame;
    }
  }

  buffer += decoder.decode();
  const { frames } = buildSSEFrames(`${buffer}\n\n`);
  for (const frame of frames) {
    yield frame;
  }
}

export class ACPClient {
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: ACPClientOptions) {
    this.baseUrl = normalizeBaseUrl(opts.baseUrl);
    this.apiKey = opts.apiKey;
    this.fetchImpl = opts.fetchImpl || fetch;
  }

  private buildHeaders(extra?: Record<string, string>): Headers {
    const headers = new Headers(extra);
    headers.set('Accept', headers.get('Accept') || 'application/json');
    if (this.apiKey) {
      headers.set('Authorization', `Bearer ${this.apiKey}`);
    }
    return headers;
  }

  private async requestJson<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      ...init,
      headers: this.buildHeaders({
        'Content-Type': 'application/json',
        ...(init?.headers as Record<string, string> | undefined),
      }),
    });

    if (!response.ok) {
      throw new Error(
        `ACP request failed (${response.status} ${response.statusText})`,
      );
    }

    return (await response.json()) as T;
  }

  async getManifest(): Promise<{ agents: ACPAgentManifest[] }> {
    return this.requestJson('/acp/agents', {
      method: 'GET',
      headers: this.buildHeaders(),
    });
  }

  async createSession(
    request: ACPCreateSessionRequest,
  ): Promise<{ session: ACPSessionDescriptor }> {
    return this.requestJson('/acp/sessions', {
      method: 'POST',
      body: JSON.stringify(request),
    });
  }

  async getSession(
    sessionId: string,
  ): Promise<{ session: ACPSessionDescriptor }> {
    return this.requestJson(`/acp/sessions/${encodeURIComponent(sessionId)}`, {
      method: 'GET',
      headers: this.buildHeaders(),
    });
  }

  async sendMessage(
    sessionId: string,
    request: ACPSendMessageRequest,
  ): Promise<unknown> {
    return this.requestJson(`/acp/sessions/${encodeURIComponent(sessionId)}`, {
      method: 'POST',
      body: JSON.stringify(request),
    });
  }

  async sendToolCalls(
    sessionId: string,
    request: ACPToolCallRequest,
  ): Promise<unknown> {
    return this.requestJson(
      `/acp/sessions/${encodeURIComponent(sessionId)}/tools`,
      {
        method: 'POST',
        body: JSON.stringify(request),
      },
    );
  }

  async streamSession(
    sessionId: string,
    handlers: ACPStreamHandlers = {},
    signal?: AbortSignal,
  ): Promise<void> {
    const response = await this.fetchImpl(
      `${this.baseUrl}/acp/sessions/${encodeURIComponent(sessionId)}?stream=1`,
      {
        method: 'GET',
        headers: this.buildHeaders({
          Accept: 'text/event-stream',
        }),
        signal,
      },
    );

    if (!response.ok || !response.body) {
      throw new Error(
        `ACP stream failed (${response.status} ${response.statusText})`,
      );
    }

    for await (const frame of parseSSE(response.body)) {
      if (!frame.data) continue;

      const event = JSON.parse(frame.data) as ACPStreamEvent;
      await handlers.onEvent?.(event);

      if (event.type === 'message' || event.type === 'message.delta') {
        await handlers.onMessage?.(event);
      }
      if (event.type === 'tool_call') {
        await handlers.onToolCall?.(event);
      }
      if (event.type === 'tool_result') {
        await handlers.onToolResult?.(event);
      }
    }
  }

  async connectThread(
    request: ACPCreateSessionRequest,
    handlers: ACPStreamHandlers = {},
    signal?: AbortSignal,
  ): Promise<ACPSessionDescriptor> {
    const { session } = await this.createSession(request);
    void this.streamSession(session.id, handlers, signal);
    return session;
  }
}
