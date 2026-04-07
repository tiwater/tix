/**
 * Tix Gateway — WebSocket relay that accepts inbound computer connections.
 *
 * Standalone package — no tix core dependencies.
 * Ticos/Supen can `import { attachGateway } from '@tix/gateway'` to embed.
 */
import http from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
export interface RemoteComputer {
    computer_id: string;
    computer_fingerprint: string;
    trusted: boolean;
    /** True if the WebSocket connection is currently open. */
    online: boolean;
    /** ISO timestamp of last message received from this computer. */
    last_seen?: string;
    /** IP address the computer connected from. */
    ip?: string;
    /** System telemetry data. */
    telemetry?: any;
}
export interface RelayResult {
    status: number;
    headers: Record<string, string>;
    body: unknown;
    encoding?: 'base64';
}
export interface GatewayOptions {
    /** Optional logger (defaults to console). */
    logger?: Pick<Console, 'log' | 'warn' | 'error' | 'info' | 'debug'>;
    /** Use noServer mode and manually handle upgrades. */
    handleUpgrade?: boolean;
}
export declare function listComputers(): RemoteComputer[];
/** Get the WebSocket for a specific computer by computer_id. */
export declare function getComputerById(computerId: string): WebSocket | null;
export declare function getActiveComputer(): WebSocket | null;
export declare function relayToComputer(method: string, path: string, body?: unknown, timeoutMs?: number, targetComputerId?: string): Promise<RelayResult>;
/**
 * Attach the WebSocket gateway to an HTTP server.
 * Call this on any http.Server to enable computer connections.
 */
export declare function attachGateway(httpServer: http.Server, opts?: GatewayOptions): WebSocketServer;
/**
 * Handle an HTTP request — route gateway API or relay to computer.
 * Returns true if the request was handled.
 */
export declare function handleGatewayRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<boolean>;
export interface StartGatewayOptions extends GatewayOptions {
    port?: number;
    host?: string;
    /** Optional HTTP request handler for non-gateway routes (e.g., serving static files). */
    onRequest?: (req: http.IncomingMessage, res: http.ServerResponse) => void;
}
/**
 * Create and start a standalone gateway server.
 * Convenience for quick setup — or use attachGateway() for more control.
 */
export declare function startGateway(opts?: StartGatewayOptions): Promise<http.Server>;
//# sourceMappingURL=index.d.ts.map