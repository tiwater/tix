function normalizeBaseUrl(baseUrl) {
    return baseUrl.replace(/\/+$/, '');
}
function buildSSEFrames(chunkBuffer) {
    const normalized = chunkBuffer.replace(/\r\n/g, '\n');
    const segments = normalized.split('\n\n');
    const remainder = normalized.endsWith('\n\n') ? '' : (segments.pop() ?? '');
    const frames = segments
        .map((segment) => {
        const frame = {};
        for (const line of segment.split('\n')) {
            if (!line || line.startsWith(':'))
                continue;
            const idx = line.indexOf(':');
            const field = idx === -1 ? line : line.slice(0, idx);
            const rawValue = idx === -1 ? '' : line.slice(idx + 1).trimStart();
            if (field === 'event')
                frame.event = rawValue;
            if (field === 'data') {
                frame.data = frame.data ? `${frame.data}\n${rawValue}` : rawValue;
            }
            if (field === 'id')
                frame.id = rawValue;
            if (field === 'retry') {
                const retry = Number(rawValue);
                if (Number.isFinite(retry))
                    frame.retry = retry;
            }
        }
        return frame;
    })
        .filter((frame) => frame.data || frame.event || frame.id);
    return { frames, remainder };
}
export async function* parseSSE(stream) {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
        const { done, value } = await reader.read();
        if (done)
            break;
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
    baseUrl;
    apiKey;
    fetchImpl;
    constructor(opts) {
        this.baseUrl = normalizeBaseUrl(opts.baseUrl);
        this.apiKey = opts.apiKey;
        this.fetchImpl = opts.fetchImpl || fetch;
    }
    buildHeaders(extra) {
        const headers = new Headers(extra);
        headers.set('Accept', headers.get('Accept') || 'application/json');
        if (this.apiKey) {
            headers.set('Authorization', `Bearer ${this.apiKey}`);
        }
        return headers;
    }
    async requestJson(path, init) {
        const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
            ...init,
            headers: this.buildHeaders({
                'Content-Type': 'application/json',
                ...init?.headers,
            }),
        });
        if (!response.ok) {
            throw new Error(`ACP request failed (${response.status} ${response.statusText})`);
        }
        return (await response.json());
    }
    async getManifest() {
        return this.requestJson('/acp/agents', {
            method: 'GET',
            headers: this.buildHeaders(),
        });
    }
    async createSession(request) {
        return this.requestJson('/acp/sessions', {
            method: 'POST',
            body: JSON.stringify(request),
        });
    }
    async getSession(sessionId) {
        return this.requestJson(`/acp/sessions/${encodeURIComponent(sessionId)}`, {
            method: 'GET',
            headers: this.buildHeaders(),
        });
    }
    async sendMessage(sessionId, request) {
        return this.requestJson(`/acp/sessions/${encodeURIComponent(sessionId)}`, {
            method: 'POST',
            body: JSON.stringify(request),
        });
    }
    async sendToolCalls(sessionId, request) {
        return this.requestJson(`/acp/sessions/${encodeURIComponent(sessionId)}/tools`, {
            method: 'POST',
            body: JSON.stringify(request),
        });
    }
    async streamSession(sessionId, handlers = {}, signal) {
        const response = await this.fetchImpl(`${this.baseUrl}/acp/sessions/${encodeURIComponent(sessionId)}?stream=1`, {
            method: 'GET',
            headers: this.buildHeaders({
                Accept: 'text/event-stream',
            }),
            signal,
        });
        if (!response.ok || !response.body) {
            throw new Error(`ACP stream failed (${response.status} ${response.statusText})`);
        }
        for await (const frame of parseSSE(response.body)) {
            if (!frame.data)
                continue;
            const event = JSON.parse(frame.data);
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
    async connectThread(request, handlers = {}, signal) {
        const { session } = await this.createSession(request);
        void this.streamSession(session.id, handlers, signal);
        return session;
    }
}
//# sourceMappingURL=acp-client.js.map