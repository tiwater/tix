import WebSocket from 'ws';
import http from 'http';
import crypto from 'crypto';
import { logger } from '../core/logger.js';
import { readGatewayConfig, GatewayConfig } from '../core/gateway-config.js';
import { validateOutboundEndpoint } from '../core/security.js';
import {
  readEnrollmentState,
  verifyEnrollmentToken,
} from '../core/enrollment.js';
import { NODE_HOSTNAME, HTTP_PORT } from '../core/config.js';
import { Channel, NewMessage, RegisteredProject } from '../core/types.js';
import { registerChannel, ChannelOpts } from './registry.js';

const GATEWAY_JID_PREFIX = 'gateway:';

export class GatewayClientChannel implements Channel {
  name = 'gateway-client';
  private ws: WebSocket | null = null;
  private opts: ChannelOpts;
  private _connected = false;
  private config: GatewayConfig;
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private reportingInterval: NodeJS.Timeout | null = null;
  private activeSseSubscriptions = new Map<string, { destroy: () => void }>();

  constructor(opts: ChannelOpts) {
    this.opts = opts;
    this.config = readGatewayConfig();
  }

  async connect(): Promise<void> {
    if (!this.config.gateway_url) {
      logger.debug('No gateway_url configured, GatewayClientChannel disabled');
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
        'Refusing to connect gateway-client to untrusted endpoint',
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

    this.ws.on('message', (data) => {
      this.handleMessage(data);
    });

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

    // If we have a trust_token in config and we are not yet trusted, attempt enrollment
    if (this.config.trust_token && state.trust_state !== 'trusted') {
      logger.info('Attempting enrollment with gateway using trust_token');
      this.ws?.send(
        JSON.stringify({
          type: 'enroll',
          token: this.config.trust_token,
          gateway_token: gatewayToken,
          node_id: state.node_id,
          node_fingerprint: state.node_fingerprint,
        }),
      );
    } else {
      this.ws?.send(
        JSON.stringify({
          type: 'auth',
          // gateway_token carries the HMAC credential when GATEWAY_SECRET is set
          token: gatewayToken,
          node_id: state.node_id,
          node_fingerprint: state.node_fingerprint,
        }),
      );
    }
  }

  /**
   * Build a HMAC token for gateway authentication.
   * Format: `${nodeId}.${timestampMs}.${hmacHex}`
   * Only generated when the GATEWAY_SECRET env var is set on the node side.
   */
  private buildGatewayToken(nodeId: string): string | undefined {
    const secret = process.env.GATEWAY_SECRET;
    if (!secret) return undefined;
    const ts = Date.now().toString();
    const hmac = crypto
      .createHmac('sha256', secret)
      .update(`${nodeId}:${ts}`)
      .digest('hex');
    return `${nodeId}.${ts}.${hmac}`;
  }

  private startReporting(): void {
    const interval = this.config.reporting_interval || 60000;
    this.reportingInterval = setInterval(() => {
      if (this._connected && this.ws?.readyState === WebSocket.OPEN) {
        const state = readEnrollmentState(NODE_HOSTNAME || undefined);
        this.ws.send(
          JSON.stringify({
            type: 'report',
            status: 'online',
            trust_state: state.trust_state,
            timestamp: new Date().toISOString(),
          }),
        );
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
        const { agent_id, session_id, content, sender, sender_name, task_id } =
          payload;
        const chatJid = `${GATEWAY_JID_PREFIX}${agent_id}:${session_id}`;

        const msg: NewMessage = {
          id:
            payload.id ||
            `gateway-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
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

        this.opts.onChatMetadata(
          chatJid,
          msg.timestamp,
          agent_id,
          'gateway',
          false,
        );
        this.opts.onMessage(chatJid, msg);
        return;
      }

      // Handle api_request: relay to local HTTP server
      if (payload.type === 'api_request') {
        this.handleApiRequest(payload);
        return;
      }

      // Handle sse_subscribe: relay SSE stream from local HTTP server
      if (payload.type === 'sse_subscribe') {
        this.handleSseSubscribe(payload);
        return;
      }
    } catch (err) {
      logger.error({ err }, 'Failed to handle gateway message');
    }
  }

  private async handleApiRequest(payload: {
    request_id: string;
    method: string;
    path: string;
    body?: unknown;
  }): Promise<void> {
    const localUrl = `http://127.0.0.1:${HTTP_PORT}${payload.path}`;

    try {
      const fetchOpts: RequestInit = {
        method: payload.method || 'GET',
        headers: { 'Content-Type': 'application/json' },
      };
      if (payload.body && payload.method !== 'GET') {
        fetchOpts.body = JSON.stringify(payload.body);
      }

      const res = await fetch(localUrl, fetchOpts);
      const contentType = res.headers.get('content-type') || '';
      const isJson = contentType.includes('application/json');

      if (isJson) {
        const body = await res.text();
        let parsed: unknown;
        try {
          parsed = JSON.parse(body);
        } catch {
          parsed = body;
        }
        this.ws?.send(
          JSON.stringify({
            type: 'api_response',
            request_id: payload.request_id,
            status: res.status,
            headers: {},
            body: parsed,
          }),
        );
      } else {
        // Binary responses (images, PDFs, etc.): base64-encode
        const buffer = Buffer.from(await res.arrayBuffer());
        this.ws?.send(
          JSON.stringify({
            type: 'api_response',
            request_id: payload.request_id,
            status: res.status,
            headers: {
              'content-type': contentType,
              'content-disposition': res.headers.get('content-disposition') || '',
              'content-length': String(buffer.length),
              'cache-control': res.headers.get('cache-control') || '',
            },
            body: buffer.toString('base64'),
            encoding: 'base64',
          }),
        );
      }
    } catch (err) {
      logger.error({ err, path: payload.path }, 'Failed to relay API request to gateway');
      this.ws?.send(
        JSON.stringify({
          type: 'api_response',
          request_id: payload.request_id,
          status: 502,
          headers: {},
          body: { error: 'relay_failed', message: String(err) },
        }),
      );
    }
  }

  private handleSseSubscribe(payload: {
    request_id: string;
    path: string;
  }): void {
    const streamKey = payload.path;

    // Abort any existing subscription for this stream_key
    const existing = this.activeSseSubscriptions.get(streamKey);
    if (existing) {
      logger.info({ path: streamKey }, 'SSE relay: aborting old subscription');
      existing.destroy();
      this.activeSseSubscriptions.delete(streamKey);
    }

    const localUrl = `http://127.0.0.1:${HTTP_PORT}${streamKey}`;
    logger.info({ path: streamKey }, 'SSE relay: subscribing to local stream');

    const req = http.get(localUrl, (res) => {
      let buffer = '';

      res.on('data', (chunk: Buffer) => {
        buffer += chunk.toString();

        const parts = buffer.split('\n\n');
        buffer = parts.pop() || '';

        for (const part of parts) {
          if (!part.trim()) continue;
          const dataLine = part.split('\n').find((l) => l.startsWith('data: '));
          if (!dataLine) continue;

          try {
            const eventData = JSON.parse(dataLine.slice(6));
            this.ws?.send(
              JSON.stringify({
                type: 'sse_event',
                stream_key: streamKey,
                event: eventData,
              }),
            );
          } catch {
            this.ws?.send(
              JSON.stringify({
                type: 'sse_event',
                stream_key: streamKey,
                event: { raw: dataLine.slice(6) },
              }),
            );
          }
        }
      });

      res.on('end', () => {
        logger.debug({ path: streamKey }, 'SSE relay: local stream ended');
        this.activeSseSubscriptions.delete(streamKey);
      });

      res.on('error', (err) => {
        logger.debug({ err, path: streamKey }, 'SSE relay: stream error');
        this.activeSseSubscriptions.delete(streamKey);
      });
    });

    req.on('error', (err) => {
      logger.error({ err, path: streamKey }, 'SSE relay: failed to connect');
    });

    this.activeSseSubscriptions.set(streamKey, {
      destroy: () => req.destroy(),
    });
  }

  async sendMessage(jid: string, text: string): Promise<void> {
    if (!this._connected || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      logger.warn({ jid }, 'Cannot send message: Gateway not connected');
      return;
    }

    const parts = jid.slice(GATEWAY_JID_PREFIX.length).split(':');
    const agent_id = parts[0];
    const session_id = parts[1];

    this.ws.send(
      JSON.stringify({
        type: 'message',
        agent_id,
        session_id,
        content: text,
        timestamp: new Date().toISOString(),
      }),
    );
  }

  async sendFile(
    jid: string,
    filePath: string,
    caption?: string,
  ): Promise<void> {
    logger.warn('GatewayClientChannel.sendFile not implemented');
  }

  isConnected(): boolean {
    return this._connected;
  }

  ownsJid(jid: string): boolean {
    return jid.startsWith(GATEWAY_JID_PREFIX);
  }

  async disconnect(): Promise<void> {
    this._connected = false;
    this.stopReporting();
    if (this.reconnectTimeout) clearTimeout(this.reconnectTimeout);
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}

function createGatewayClientChannel(opts: ChannelOpts): GatewayClientChannel | null {
  const config = readGatewayConfig();
  if (!config.gateway_url) return null;
  try {
    validateOutboundEndpoint(config.gateway_url, {
      allowedProtocols: ['ws:', 'wss:'],
      label: 'gateway_url',
    });
  } catch (err: any) {
    logger.error(
      { err: err.message, gateway_url: config.gateway_url },
      'Gateway client channel disabled due to endpoint security policy',
    );
    return null;
  }
  return new GatewayClientChannel(opts);
}

registerChannel('gateway-client', createGatewayClientChannel);
