/**
 * Robust Connection Manager for DingTalk Stream.
 * Adapted from OpenTix's high-quality implementation.
 */
export declare enum ConnectionState {
    DISCONNECTED = "DISCONNECTED",
    CONNECTING = "CONNECTING",
    CONNECTED = "CONNECTED",
    FAILED = "FAILED",
    DISCONNECTING = "DISCONNECTING"
}
export interface ConnectionConfig {
    maxAttempts: number;
    initialDelay: number;
    maxDelay: number;
    jitter: number;
}
export declare class ConnectionManager {
    private state;
    private attemptCount;
    private reconnectTimer?;
    private stopped;
    private config;
    private client;
    private appId;
    constructor(client: any, appId: string);
    private calculateNextDelay;
    connect(): Promise<void>;
    private setupMonitoring;
    stop(): void;
    isConnected(): boolean;
}
//# sourceMappingURL=connection.d.ts.map