import WebSocket from 'ws';
import http from 'http';
import crypto from 'crypto';
import os from 'os';
import fs from 'fs';
import { logger } from './logger.js';
import { readGatewayConfig, GatewayConfig } from './gateway-config.js';
import { validateOutboundEndpoint } from './security.js';
import { readEnrollmentState, verifyEnrollmentToken } from './enrollment.js';
import { NODE_HOSTNAME, HTTP_API_KEY, HTTP_PORT, TICLAW_HOME } from './config.js';
import { NewMessage } from './types.js';

const GATEWAY_JID_PREFIX = 'gateway:';

export interface GatewayCallbacks {
  onMessage: (chatJid: string, msg: NewMessage) => void;
  onChatMetadata: (chatJid: string, timestamp: string, name?: string, channel?: string, isGroup?: boolean) => void;
}

/**
 * Gateway — the node's outbound uplink to the TiClaw Gateway.
 *
 * Architecture:
 *   - Nodes connect outward to the gateway and receive instructions from it.
 *   - The gateway accepts connections from controller platforms (Supen, etc.)
 *     that drive the nodes via channels (Discord, HTTP, ACP, …).
 *
 * This is core infrastructure, not a consumer channel.
 * Instantiated directly in index.ts, not via the channel registry.
 */
export class Gateway {
  private ws: WebSocket | null = null;
  private _connected = false;
  private config: GatewayConfig;
  private callbacks: GatewayCallbacks;
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private reportingInterval: NodeJS.Timeout | null = null;
  private activeSseSubscriptions = new Map<string, { destroy: () => void }>();

  constructor(callbacks: GatewayCallbacks) {
    this.callbacks = callbacks;
    this.config = readGatewayConfig();
  }

  async connect(): Promise<void> {
    if (!this.config.gateway_url) {
      logger.debug('No gateway_url configured, Gateway uplink disabled');
      return;
    }
    await this.initiateConnection();
  }

  private async initiateConnection(): Promise<void> {
    if (this.reconnectTimeout) clearTimeout(this.reconnectTimeout);

    const rawUrl = this.config.gateway_url!;
    let url: string;
    try {
      url = validateOutboundEndpoint(rawUrl, {
        allowedProtocols: ['ws:', 'wss:'],
        label: 'gateway_url',
      }).toString();
    } catch (err: any) {
      logger.error(
        { err: err.message, gateway_url: rawUrl },
        'Refusing to connect to gateway: untrusted endpoint',
      );
      this._connected = false;
      return;
    }

    logger.info({ url }, 'Connecting to gateway...');
    this.ws = new WebSocket(url);

    this.ws.on('open', () => {
      logger.info({ url }, 'Connected to gateway');
      this._connected = true;
      this.authenticate();
      this.startReporting();
    });

    this.ws.on('message', (data) => this.handleMessage(data));

    this.ws.on('close', () => {
      this._connected = false;
      logger.warn('Gateway connection closed, reconnecting in 5s...');
      this.stopReporting();
      this.reconnectTimeout = setTimeout(() => this.initiateConnection(), 5000);
    });

    this.ws.on('error', (err) => {
      logger.error({ err }, 'Gateway connection error');
    });
  }

  private authenticate(): void {
    const state = readEnrollmentState(NODE_HOSTNAME || undefined);
    const gatewayToken = this.buildGatewayToken(state.node_id);

    if (this.config.trust_token && state.trust_state !== 'trusted') {
      logger.info('Attempting enrollment with gateway using trust_token');
      this.ws?.send(JSON.stringify({
        type: 'enroll',
        token: this.config.trust_token,
        gateway_token: gatewayToken,
        node_id: state.node_id,
        node_fingerprint: state.node_fingerprint,
      }));
    } else {
      this.ws?.send(JSON.stringify({
        type: 'auth',
        token: gatewayToken,
        node_id: state.node_id,
        node_fingerprint: state.node_fingerprint,
      }));
    }
  }

  /**
   * Build a HMAC token for gateway authentication.
   * Format: `${nodeId}.${timestampMs}.${hmacHex}`
   * Only when TICLAW_GATEWAY_SECRET env var is set on the node side.
   */
  private buildGatewayToken(nodeId: string): string | undefined {
    const secret = process.env.TICLAW_GATEWAY_SECRET;
    if (!secret) return undefined;
    const ts = Date.now().toString();
    const hmac = crypto.createHmac('sha256', secret).update(`${nodeId}:${ts}`).digest('hex');
    return `${nodeId}.${ts}.${hmac}`;
  }

  private startReporting(): void {
    const interval = this.config.reporting_interval || 60000;
    this.reportingInterval = setInterval(() => {
      if (this._connected && this.ws?.readyState === WebSocket.OPEN) {
        const state = readEnrollmentState(NODE_HOSTNAME || undefined);
        
        // System Telemetry
        const cpus = os.cpus();
        const memTotal = os.totalmem();
        const memFree = os.freemem();
        
        let disk_total: number | undefined;
        let disk_free: number | undefined;
        let disk_used: number | undefined;
        try {
          const stats = fs.statfsSync(TICLAW_HOME);
          disk_total = stats.bsize * stats.blocks;
          disk_free = stats.bsize * stats.bavail;
          disk_used = disk_total - disk_free;
        } catch { /* ignore */ }

        this.ws.send(JSON.stringify({
          type: 'report',
          status: 'online',
          trust_state: state.trust_state,
          timestamp: new Date().toISOString(),
          telemetry: {
            os: {
              platform: os.platform(),
              arch: os.arch(),
              cpus: cpus.length,
              cpu_model: cpus[0]?.model || 'Unknown',
              load_avg: os.loadavg(),
              mem_total: memTotal,
              mem_free: memFree,
              mem_used: memTotal - memFree,
              uptime: os.uptime(),
              disk_total,
              disk_free,
              disk_used,
            }
          }
        }));
      }
    }, interval);
  }

  private stopReporting(): void {
    if (this.reportingInterval) {
      clearInterval(this.reportingInterval);
      this.reportingInterval = null;
    }
  }

  private handleMessage(data: WebSocket.Data): void {
    try {
      const payload = JSON.parse(data.toString());
      logger.debug({ payload }, 'Received message from gateway');

      if (payload.type === 'enrollment_result') {
        if (payload.ok) {
          logger.info('Gateway enrollment successful');
          verifyEnrollmentToken({
            token: this.config.trust_token!,
            nodeFingerprint: payload.node_fingerprint,
            nodeId: NODE_HOSTNAME || undefined,
          });
        } else {
          logger.error({ code: payload.code }, 'Gateway enrollment failed');
        }
        return;
      }

      if (payload.type === 'message') {
        const { agent_id, session_id, content, sender, sender_name, task_id } = payload;
        const chatJid = `${GATEWAY_JID_PREFIX}${agent_id}:${session_id}`;
        const msg: NewMessage = {
          id: payload.id || `gateway-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          chat_jid: chatJid,
          sender: sender || 'gateway-user',
          sender_name: sender_name || 'Gateway User',
          content,
          timestamp: payload.timestamp || new Date().toISOString(),
          is_from_me: false,
          agent_id,
          session_id,
          task_id: task_id || `gateway-task-${Date.now()}`,
        };
        this.callbacks.onChatMetadata(chatJid, msg.timestamp, agent_id, 'gateway', false);
        this.callbacks.onMessage(chatJid, msg);
        return;
      }

      if (payload.type === 'api_request') { this.handleApiRequest(payload); return; }
      if (payload.type === 'sse_subscribe') { this.handleSseSubscribe(payload); return; }
    } catch (err) {
      logger.error({ err }, 'Failed to handle gateway message');
    }
  }

  private async handleApiRequest(payload: {
    request_id: string; method: string; path: string; body?: unknown;
  }): Promise<void> {
    const localUrl = `http://127.0.0.1:${HTTP_PORT}${payload.path}`;
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (HTTP_API_KEY.trim()) {
        headers['X-API-Key'] = HTTP_API_KEY.trim();
      }

      const fetchOpts: RequestInit = {
        method: payload.method || 'GET',
        headers,
      };
      if (payload.body && payload.method !== 'GET') fetchOpts.body = JSON.stringify(payload.body);

      const res = await fetch(localUrl, fetchOpts);
      const contentType = res.headers.get('content-type') || '';

      if (contentType.includes('application/json')) {
        const body = await res.text();
        let parsed: unknown;
        try { parsed = JSON.parse(body); } catch { parsed = body; }
        this.ws?.send(JSON.stringify({ type: 'api_response', request_id: payload.request_id, status: res.status, headers: {}, body: parsed }));
      } else {
        const buffer = Buffer.from(await res.arrayBuffer());
        this.ws?.send(JSON.stringify({
          type: 'api_response', request_id: payload.request_id, status: res.status, encoding: 'base64',
          headers: { 'content-type': contentType, 'content-disposition': res.headers.get('content-disposition') || '', 'content-length': String(buffer.length), 'cache-control': res.headers.get('cache-control') || '' },
          body: buffer.toString('base64'),
        }));
      }
    } catch (err) {
      logger.error({ err, path: payload.path }, 'Failed to relay API request to gateway');
      this.ws?.send(JSON.stringify({ type: 'api_response', request_id: payload.request_id, status: 502, headers: {}, body: { error: 'relay_failed', message: String(err) } }));
    }
  }

  private handleSseSubscribe(payload: { request_id: string; path: string }): void {
    const streamKey = payload.path;
    const existing = this.activeSseSubscriptions.get(streamKey);
    if (existing) { existing.destroy(); this.activeSseSubscriptions.delete(streamKey); }

    const localUrl = `http://127.0.0.1:${HTTP_PORT}${streamKey}`;
    logger.info({ path: streamKey }, 'SSE relay: subscribing to local stream');

    const headers: Record<string, string> = {};
    if (HTTP_API_KEY.trim()) {
      headers['X-API-Key'] = HTTP_API_KEY.trim();
    }

    const req = http.get(localUrl, { headers }, (res) => {
      let buf = '';
      res.on('data', (chunk: Buffer) => {
        buf += chunk.toString();
        const parts = buf.split('\n\n');
        buf = parts.pop() || '';
        for (const part of parts) {
          if (!part.trim()) continue;
          const dataLine = part.split('\n').find((l) => l.startsWith('data: '));
          if (!dataLine) continue;
          try {
            this.ws?.send(JSON.stringify({ type: 'sse_event', stream_key: streamKey, event: JSON.parse(dataLine.slice(6)) }));
          } catch {
            this.ws?.send(JSON.stringify({ type: 'sse_event', stream_key: streamKey, event: { raw: dataLine.slice(6) } }));
          }
        }
      });
      res.on('end', () => this.activeSseSubscriptions.delete(streamKey));
      res.on('error', (err) => { logger.debug({ err, path: streamKey }, 'SSE relay: stream error'); this.activeSseSubscriptions.delete(streamKey); });
    });
    req.on('error', (err) => logger.error({ err, path: streamKey }, 'SSE relay: failed to connect'));
    this.activeSseSubscriptions.set(streamKey, { destroy: () => req.destroy() });
  }

  /** Send a message back to the gateway (from a local agent reply). */
  async sendMessage(chatJid: string, text: string): Promise<void> {
    if (!this._connected || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      logger.warn({ chatJid }, 'Cannot send message: Gateway not connected');
      return;
    }
    const parts = chatJid.slice(GATEWAY_JID_PREFIX.length).split(':');
    this.ws.send(JSON.stringify({ type: 'message', agent_id: parts[0], session_id: parts[1], content: text, timestamp: new Date().toISOString() }));
  }

  /** Check if this JID belongs to a gateway session. */
  ownsJid(jid: string): boolean { return jid.startsWith(GATEWAY_JID_PREFIX); }

  isConnected(): boolean { return this._connected; }

  async disconnect(): Promise<void> {
    this._connected = false;
    this.stopReporting();
    if (this.reconnectTimeout) clearTimeout(this.reconnectTimeout);
    if (this.ws) { this.ws.close(); this.ws = null; }
  }
}
