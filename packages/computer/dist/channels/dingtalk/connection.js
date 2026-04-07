/**
 * Robust Connection Manager for DingTalk Stream.
 * Adapted from OpenTix's high-quality implementation.
 */
import { logger } from '../../core/logger.js';
export var ConnectionState;
(function (ConnectionState) {
    ConnectionState["DISCONNECTED"] = "DISCONNECTED";
    ConnectionState["CONNECTING"] = "CONNECTING";
    ConnectionState["CONNECTED"] = "CONNECTED";
    ConnectionState["FAILED"] = "FAILED";
    ConnectionState["DISCONNECTING"] = "DISCONNECTING";
})(ConnectionState || (ConnectionState = {}));
export class ConnectionManager {
    state = ConnectionState.DISCONNECTED;
    attemptCount = 0;
    reconnectTimer;
    stopped = false;
    config = {
        maxAttempts: 10,
        initialDelay: 1000,
        maxDelay: 60000,
        jitter: 0.3,
    };
    client;
    appId;
    constructor(client, appId) {
        this.client = client;
        this.appId = appId;
    }
    calculateNextDelay(attempt) {
        const exponentialDelay = this.config.initialDelay * Math.pow(2, attempt);
        const cappedDelay = Math.min(exponentialDelay, this.config.maxDelay);
        const jitterAmount = cappedDelay * this.config.jitter;
        const randomJitter = (Math.random() * 2 - 1) * jitterAmount;
        return Math.floor(Math.max(100, cappedDelay + randomJitter));
    }
    async connect() {
        if (this.stopped)
            return;
        this.state = ConnectionState.CONNECTING;
        this.attemptCount++;
        logger.info({ appId: this.appId, attempt: this.attemptCount }, 'DingTalk attempting to connect...');
        try {
            await this.client.start();
            this.state = ConnectionState.CONNECTED;
            this.attemptCount = 0;
            logger.info({ appId: this.appId }, 'DingTalk connected successfully');
            // Setup zombie detection (simpler version for Tix)
            this.setupMonitoring();
        }
        catch (err) {
            this.state = ConnectionState.FAILED;
            logger.error({ appId: this.appId, err: err.message }, 'DingTalk connection failed');
            if (this.attemptCount < this.config.maxAttempts) {
                const delay = this.calculateNextDelay(this.attemptCount - 1);
                logger.warn({ appId: this.appId, delay }, `DingTalk retrying in ${delay}ms`);
                this.reconnectTimer = setTimeout(() => this.connect(), delay);
            }
        }
    }
    setupMonitoring() {
        // In a real implementation, we would hook into the internal WebSocket
        // but for now we rely on the client's internal reconnect if available.
    }
    stop() {
        this.stopped = true;
        if (this.reconnectTimer)
            clearTimeout(this.reconnectTimer);
        this.state = ConnectionState.DISCONNECTED;
    }
    isConnected() {
        return this.state === ConnectionState.CONNECTED;
    }
}
//# sourceMappingURL=connection.js.map