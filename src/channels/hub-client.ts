import WebSocket from 'ws';
import { logger } from '../core/logger.js';
import { readHubConfig, HubConfig } from '../core/hub-config.js';
import {
  readEnrollmentState,
  verifyEnrollmentToken,
} from '../core/enrollment.js';
import { CLAW_HOSTNAME } from '../core/config.js';
import { Channel, NewMessage, RegisteredProject } from '../core/types.js';
import { registerChannel, ChannelOpts } from './registry.js';

const HUB_JID_PREFIX = 'hub:';

export class HubClientChannel implements Channel {
  name = 'hub-client';
  private ws: WebSocket | null = null;
  private opts: ChannelOpts;
  private _connected = false;
  private config: HubConfig;
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private reportingInterval: NodeJS.Timeout | null = null;
  private activeSseSubscriptions = new Map<string, { destroy: () => void }>();

  constructor(opts: ChannelOpts) {
    this.opts = opts;
    this.config = readHubConfig();
  }

  async connect(): Promise<void> {
    if (!this.config.hub_url) {
      logger.debug('No hub_url configured, HubClientChannel disabled');
      return;
    }

    await this.initiateConnection();
  }

  private async initiateConnection(): Promise<void> {
    if (this.reconnectTimeout) clearTimeout(this.reconnectTimeout);

    const url = this.config.hub_url!;
    logger.info({ url }, 'Connecting to hub...');

    this.ws = new WebSocket(url);

    this.ws.on('open', () => {
      logger.info({ url }, 'Connected to hub');
      this._connected = true;
      this.authenticate();
      this.startReporting();
    });

    this.ws.on('message', (data) => {
      this.handleMessage(data);
    });

    this.ws.on('close', () => {
      this._connected = false;
      logger.warn('Hub connection closed, reconnecting in 5s...');
      this.stopReporting();
      this.reconnectTimeout = setTimeout(() => this.initiateConnection(), 5000);
    });

    this.ws.on('error', (err) => {
      logger.error({ err }, 'Hub connection error');
    });
  }

  private authenticate(): void {
    const state = readEnrollmentState(CLAW_HOSTNAME || undefined);

    // If we have a trust_token in config and we are not yet trusted, attempt enrollment
    if (this.config.trust_token && state.trust_state !== 'trusted') {
      logger.info('Attempting enrollment with hub using trust_token');
      this.ws?.send(
        JSON.stringify({
          type: 'enroll',
          token: this.config.trust_token,
          claw_id: state.claw_id,
          claw_fingerprint: state.claw_fingerprint,
        }),
      );
    } else {
      this.ws?.send(
        JSON.stringify({
          type: 'auth',
          claw_id: state.claw_id,
          claw_fingerprint: state.claw_fingerprint,
        }),
      );
    }
  }

  private startReporting(): void {
    const interval = this.config.reporting_interval || 60000;
    this.reportingInterval = setInterval(() => {
      if (this._connected && this.ws?.readyState === WebSocket.OPEN) {
        const state = readEnrollmentState(CLAW_HOSTNAME || undefined);
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
      logger.debug({ payload }, 'Received message from hub');

      if (payload.type === 'enrollment_result') {
        if (payload.ok) {
          logger.info('Hub enrollment successful');
          // Sync enrollment state
          verifyEnrollmentToken({
            token: this.config.trust_token!,
            clawFingerprint: payload.claw_fingerprint,
            clawId: CLAW_HOSTNAME || undefined,
          });
        } else {
          logger.error({ code: payload.code }, 'Hub enrollment failed');
        }
        return;
      }

      if (payload.type === 'message') {
        const { agent_id, session_id, content, sender, sender_name, task_id } =
          payload;
        const chatJid = `${HUB_JID_PREFIX}${agent_id}:${session_id}`;

        const msg: NewMessage = {
          id:
            payload.id ||
            `hub-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          chat_jid: chatJid,
          sender: sender || 'hub-user',
          sender_name: sender_name || 'Hub User',
          content,
          timestamp: payload.timestamp || new Date().toISOString(),
          is_from_me: false,
          agent_id,
          session_id,
          task_id: task_id || `hub-task-${Date.now()}`,
        };

        this.opts.onChatMetadata(
          chatJid,
          msg.timestamp,
          agent_id,
          'hub',
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
      logger.error({ err }, 'Failed to handle hub message');
    }
  }

  private async handleApiRequest(payload: {
    request_id: string;
    method: string;
    path: string;
    body?: unknown;
  }): Promise<void> {
    const { HTTP_PORT } = await import('../core/config.js');
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
    } catch (err) {
      logger.error({ err, path: payload.path }, 'Failed to relay API request');
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

    // Connect to the claw's own local HTTP SSE endpoint and relay events
    import('../core/config.js').then(({ HTTP_PORT }) => {
      const localUrl = `http://127.0.0.1:${HTTP_PORT}${streamKey}`;
      logger.info(
        { path: streamKey },
        'SSE relay: subscribing to local stream',
      );

      import('http').then((http) => {
        const req = http.get(localUrl, (res) => {
          let buffer = '';

          res.on('data', (chunk: Buffer) => {
            buffer += chunk.toString();

            // Parse SSE events from buffer (format: "data: {...}\n\n")
            const parts = buffer.split('\n\n');
            buffer = parts.pop() || '';

            for (const part of parts) {
              if (!part.trim()) continue;
              const dataLine = part
                .split('\n')
                .find((l) => l.startsWith('data: '));
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
                // Non-JSON event, forward as-is
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
            logger.error({ err, path: streamKey }, 'SSE relay: stream error');
            this.activeSseSubscriptions.delete(streamKey);
          });
        });

        req.on('error', (err) => {
          logger.error(
            { err, path: streamKey },
            'SSE relay: failed to connect',
          );
        });

        // Track subscription so we can abort it later
        this.activeSseSubscriptions.set(streamKey, {
          destroy: () => req.destroy(),
        });
      });
    });
  }

  async sendMessage(jid: string, text: string): Promise<void> {
    if (!this._connected || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      logger.warn({ jid }, 'Cannot send message: Hub not connected');
      return;
    }

    const parts = jid.slice(HUB_JID_PREFIX.length).split(':');
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
    logger.warn('HubClientChannel.sendFile not implemented');
  }

  isConnected(): boolean {
    return this._connected;
  }

  ownsJid(jid: string): boolean {
    return jid.startsWith(HUB_JID_PREFIX);
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

function createHubClientChannel(opts: ChannelOpts): HubClientChannel | null {
  const config = readHubConfig();
  if (!config.hub_url) return null;
  return new HubClientChannel(opts);
}

registerChannel('hub-client', createHubClientChannel);
