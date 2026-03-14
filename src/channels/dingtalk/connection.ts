/**
 * Robust Connection Manager for DingTalk Stream.
 * Adapted from OpenClaw's high-quality implementation.
 */

import { logger } from '../../core/logger.js';

export enum ConnectionState {
  DISCONNECTED = 'DISCONNECTED',
  CONNECTING = 'CONNECTING',
  CONNECTED = 'CONNECTED',
  FAILED = 'FAILED',
  DISCONNECTING = 'DISCONNECTING',
}

export interface ConnectionConfig {
  maxAttempts: number;
  initialDelay: number;
  maxDelay: number;
  jitter: number;
}

export class ConnectionManager {
  private state: ConnectionState = ConnectionState.DISCONNECTED;
  private attemptCount = 0;
  private reconnectTimer?: NodeJS.Timeout;
  private stopped = false;
  
  private config: ConnectionConfig = {
    maxAttempts: 10,
    initialDelay: 1000,
    maxDelay: 60000,
    jitter: 0.3,
  };

  private client: any;
  private appId: string;

  constructor(client: any, appId: string) {
    this.client = client;
    this.appId = appId;
  }

  private calculateNextDelay(attempt: number): number {
    const exponentialDelay = this.config.initialDelay * Math.pow(2, attempt);
    const cappedDelay = Math.min(exponentialDelay, this.config.maxDelay);
    const jitterAmount = cappedDelay * this.config.jitter;
    const randomJitter = (Math.random() * 2 - 1) * jitterAmount;
    return Math.floor(Math.max(100, cappedDelay + randomJitter));
  }

  async connect(): Promise<void> {
    if (this.stopped) return;
    
    this.state = ConnectionState.CONNECTING;
    this.attemptCount++;
    
    logger.info({ appId: this.appId, attempt: this.attemptCount }, 'DingTalk attempting to connect...');

    try {
      await this.client.start();
      this.state = ConnectionState.CONNECTED;
      this.attemptCount = 0;
      logger.info({ appId: this.appId }, 'DingTalk connected successfully');
      
      // Setup zombie detection (simpler version for TiClaw)
      this.setupMonitoring();
    } catch (err: any) {
      this.state = ConnectionState.FAILED;
      logger.error({ appId: this.appId, err: err.message }, 'DingTalk connection failed');
      
      if (this.attemptCount < this.config.maxAttempts) {
        const delay = this.calculateNextDelay(this.attemptCount - 1);
        logger.warn({ appId: this.appId, delay }, `DingTalk retrying in ${delay}ms`);
        this.reconnectTimer = setTimeout(() => this.connect(), delay);
      }
    }
  }

  private setupMonitoring() {
    // In a real implementation, we would hook into the internal WebSocket 
    // but for now we rely on the client's internal reconnect if available.
  }

  stop() {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.state = ConnectionState.DISCONNECTED;
  }

  isConnected() {
    return this.state === ConnectionState.CONNECTED;
  }
}
