import type { ACPAgentManifest, ACPCreateSessionRequest, ACPSendMessageRequest, ACPSessionDescriptor, ACPStreamEvent, ACPToolCallRequest } from './acp-types.js';
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
export declare function parseSSE(stream: ReadableStream<Uint8Array>): AsyncGenerator<SSEFrame>;
export declare class ACPClient {
    private readonly baseUrl;
    private readonly apiKey?;
    private readonly fetchImpl;
    constructor(opts: ACPClientOptions);
    private buildHeaders;
    private requestJson;
    getManifest(): Promise<{
        agents: ACPAgentManifest[];
    }>;
    createSession(request: ACPCreateSessionRequest): Promise<{
        session: ACPSessionDescriptor;
    }>;
    getSession(sessionId: string): Promise<{
        session: ACPSessionDescriptor;
    }>;
    sendMessage(sessionId: string, request: ACPSendMessageRequest): Promise<unknown>;
    sendToolCalls(sessionId: string, request: ACPToolCallRequest): Promise<unknown>;
    streamSession(sessionId: string, handlers?: ACPStreamHandlers, signal?: AbortSignal): Promise<void>;
    connectThread(request: ACPCreateSessionRequest, handlers?: ACPStreamHandlers, signal?: AbortSignal): Promise<ACPSessionDescriptor>;
}
export {};
//# sourceMappingURL=acp-client.d.ts.map