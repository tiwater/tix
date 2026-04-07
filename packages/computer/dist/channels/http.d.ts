/**
 * HTTP SSE channel for Tix — REST API v1
 *
 * Node:
 *   GET  /api/v1/node                                      — node status
 *   POST /api/v1/node/trust                                — trust node
 *
 * Agents:
 *   GET    /api/v1/agents                                  — list agents
 *   POST   /api/v1/agents                                  — create agent
 *   GET    /api/v1/agents/:agent_id                        — get agent config
 *   PATCH  /api/v1/agents/:agent_id                        — update agent settings
 *   DELETE /api/v1/agents/:agent_id                        — delete agent
 *   GET    /api/v1/agents/:agent_id/mind                   — core mind files
 *   GET    /api/v1/agents/:agent_id/artifacts              — artifact index
 *   GET    /api/v1/agents/:agent_id/memory                 — memory roll
 *   POST   /api/v1/agents/:agent_id/workspace/upload       — upload files
 *   GET    /api/v1/agents/:agent_id/workspace/*            — read workspace file
 *
 * Sessions (nested under agent):
 *   GET    /api/v1/agents/:agent_id/sessions               — list sessions
 *   POST   /api/v1/agents/:agent_id/sessions               — create session
 *   GET    /api/v1/agents/:agent_id/sessions/:session_id   — get session
 *   PATCH  /api/v1/agents/:agent_id/sessions/:session_id   — update session (title)
 *   DELETE /api/v1/agents/:agent_id/sessions/:session_id   — delete session
 *   POST   /api/v1/agents/:agent_id/sessions/:session_id/stop — stop active run
 *   GET    /api/v1/agents/:agent_id/sessions/:session_id/messages — chat history
 *   POST   /api/v1/agents/:agent_id/sessions/:session_id/messages — send message
 *   GET    /api/v1/agents/:agent_id/sessions/:session_id/stream   — SSE stream
 *   GET    /api/v1/agents/:agent_id/sessions/:session_id/context  — context window usage
 *
 * Skills:
 *   GET    /api/v1/skills                                  — list
 *   GET    /api/v1/skills/:name                            — skill details
 *   POST   /api/v1/skills/:name/enable                     — enable skill
 *   POST   /api/v1/skills/:name/disable                    — disable skill
 *
 * Schedules:
 *   GET    /api/v1/schedules                               — list
 *   POST   /api/v1/schedules                               — create
 *   DELETE /api/v1/schedules/:id                           — delete
 *   POST   /api/v1/schedules/:id/toggle                    — toggle active/paused
 *   POST   /api/v1/schedules/refresh                       — force check
 *
 * System:
 *   GET    /api/v1/models                                  — list LLM models
 *   GET    /api/v1/tasks                                   — active tasks
 *   GET    /api/v1/enroll/*                                — enrollment
 *   GET    /health                                         — health check
 *
 * Legacy (still served for backwards compat — redirect or alias):
 *   POST /runs, GET /runs/:id/stream, GET /agents
 */
import { ChannelOpts } from './registry.js';
import type { Channel } from '../core/types.js';
export declare function broadcastToChat(chatJid: string, event: object): void;
export declare function isOriginAllowed(origin: string | undefined): boolean;
export declare function requiresAdminApiAccess(pathname: string, method: string): boolean;
export type HttpAdminContext = {
    actor: string;
    isAdmin: true;
    approveLevel3: true;
};
export declare function resolveHttpAdminContextFromInput(providedApiKey: string | null, isLoopback: boolean, configuredApiKeyOverride?: string): HttpAdminContext | null;
export declare function deriveHttpSenderIdentity(context: HttpAdminContext): {
    sender: string;
    sender_name: string;
};
export declare function getHttpSecurityPosture(config: {
    httpEnabled: boolean;
    httpApiKey: string;
    allowedOrigins: string;
}): {
    mode: 'disabled' | 'dev_loopback_only' | 'protected';
    warnings: string[];
    bindHost: string | undefined;
};
export declare class HttpChannel implements Channel {
    name: string;
    private server;
    private wss;
    private opts;
    private _connected;
    constructor(opts: ChannelOpts);
    connect(): Promise<void>;
    private handleWebSocket;
    private handleRequest;
    sendMessage(jid: string, text: string, options?: {
        embeds?: any[];
        message_id?: string;
    }): Promise<void>;
    sendFile(jid: string, filePath: string, caption?: string): Promise<void>;
    isConnected(): boolean;
    ownsJid(jid: string): boolean;
    disconnect(): Promise<void>;
}
//# sourceMappingURL=http.d.ts.map