/**
 * TiClaw Gateway — OpenAPI 3.0 spec.
 * Served at GET /openapi.json so controller platforms (Supen, etc.)
 * can discover the full API without copying documentation.
 */

export function buildOpenApiSpec(opts: { gateway_url?: string } = {}): object {
  const serverUrl = opts.gateway_url || 'http://localhost:2755';

  return {
    openapi: '3.0.3',
    info: {
      title: 'TiClaw Gateway API',
      version: '1.0.0',
      description:
        'HTTP API exposed by the TiClaw Gateway. All /api/v1/* routes are transparently relayed to the connected node. Use X-Node-Id to target a specific node when multiple are connected.',
    },
    servers: [{ url: serverUrl, description: 'TiClaw Gateway' }],
    security: [{ bearerAuth: [] }],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          description:
            'API key set via GATEWAY_API_KEY env var. Omit if gateway is in open mode.',
        },
      },
      parameters: {
        nodeId: {
          name: 'X-Node-Id',
          in: 'header',
          required: false,
          schema: { type: 'string' },
          description: 'Target a specific node by its node_id. Omit to use first connected node.',
        },
        agentId: {
          name: 'agent_id',
          in: 'path',
          required: true,
          schema: { type: 'string' },
        },
        sessionId: {
          name: 'session_id',
          in: 'path',
          required: true,
          schema: { type: 'string' },
        },
        skillName: {
          name: 'name',
          in: 'path',
          required: true,
          schema: { type: 'string' },
        },
        scheduleId: {
          name: 'id',
          in: 'path',
          required: true,
          schema: { type: 'string' },
        },
      },
      schemas: {
        Agent: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
            description: { type: 'string' },
            model: { type: 'string' },
            session_count: { type: 'integer' },
          },
        },
        Session: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            agent_id: { type: 'string' },
            title: { type: 'string' },
            created_at: { type: 'string', format: 'date-time' },
            updated_at: { type: 'string', format: 'date-time' },
          },
        },
        Message: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            role: { type: 'string', enum: ['user', 'assistant'] },
            content: { type: 'string' },
            timestamp: { type: 'string', format: 'date-time' },
          },
        },
        NodeInfo: {
          type: 'object',
          properties: {
            node_id: { type: 'string' },
            node_fingerprint: { type: 'string' },
            trusted: { type: 'boolean' },
            online: { type: 'boolean' },
            last_seen: { type: 'string', format: 'date-time' },
            ip: { type: 'string' },
          },
        },
        Error: {
          type: 'object',
          properties: {
            error: { type: 'string' },
            message: { type: 'string' },
          },
        },
      },
    },
    paths: {
      // ── Gateway native ──────────────────────────────────────────────────
      '/health': {
        get: {
          tags: ['Gateway'],
          summary: 'Gateway health',
          description: 'Returns gateway status and connected node count. Does not relay to node.',
          security: [],
          responses: {
            '200': {
              description: 'OK',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      status: { type: 'string', example: 'ok' },
                      gateway: { type: 'boolean' },
                      nodes_connected: { type: 'integer' },
                      uptime_s: { type: 'integer' },
                    },
                  },
                },
              },
            },
          },
        },
      },
      '/openapi.json': {
        get: {
          tags: ['Gateway'],
          summary: 'OpenAPI spec',
          description: 'This document.',
          security: [],
          responses: { '200': { description: 'OpenAPI 3.0 JSON' } },
        },
      },
      '/api/gateway/nodes': {
        get: {
          tags: ['Gateway'],
          summary: 'List connected nodes',
          responses: {
            '200': {
              description: 'OK',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      nodes: {
                        type: 'array',
                        items: { $ref: '#/components/schemas/NodeInfo' },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },

      // ── Agents ──────────────────────────────────────────────────────────
      '/api/v1/agents': {
        get: {
          tags: ['Agents'],
          summary: 'List agents',
          parameters: [{ $ref: '#/components/parameters/nodeId' }],
          responses: { '200': { description: 'Agent list' } },
        },
        post: {
          tags: ['Agents'],
          summary: 'Create agent',
          parameters: [{ $ref: '#/components/parameters/nodeId' }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['id'],
                  properties: {
                    id: { type: 'string' },
                    name: { type: 'string' },
                    description: { type: 'string' },
                  },
                },
              },
            },
          },
          responses: { '200': { description: 'Created agent' } },
        },
      },
      '/api/v1/agents/{agent_id}': {
        parameters: [{ $ref: '#/components/parameters/agentId' }, { $ref: '#/components/parameters/nodeId' }],
        get: {
          tags: ['Agents'],
          summary: 'Get agent config',
          responses: { '200': { description: 'Agent detail', content: { 'application/json': { schema: { $ref: '#/components/schemas/Agent' } } } } },
        },
        patch: {
          tags: ['Agents'],
          summary: 'Update agent config',
          requestBody: { required: true, content: { 'application/json': { schema: { type: 'object' } } } },
          responses: { '200': { description: 'Updated' } },
        },
        delete: {
          tags: ['Agents'],
          summary: 'Delete agent',
          responses: { '200': { description: 'Deleted' } },
        },
      },

      // ── Sessions ─────────────────────────────────────────────────────────
      '/api/v1/agents/{agent_id}/sessions': {
        parameters: [{ $ref: '#/components/parameters/agentId' }, { $ref: '#/components/parameters/nodeId' }],
        get: {
          tags: ['Sessions'],
          summary: 'List sessions',
          responses: { '200': { description: 'Sessions list' } },
        },
        post: {
          tags: ['Sessions'],
          summary: 'Create session',
          requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { title: { type: 'string' } } } } } },
          responses: { '200': { description: 'Created session', content: { 'application/json': { schema: { $ref: '#/components/schemas/Session' } } } } },
        },
      },
      '/api/v1/agents/{agent_id}/sessions/{session_id}': {
        parameters: [{ $ref: '#/components/parameters/agentId' }, { $ref: '#/components/parameters/sessionId' }, { $ref: '#/components/parameters/nodeId' }],
        get: { tags: ['Sessions'], summary: 'Get session', responses: { '200': { description: 'Session detail' } } },
        patch: {
          tags: ['Sessions'],
          summary: 'Update session title',
          requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: { title: { type: 'string' } } } } } },
          responses: { '200': { description: 'Updated' } },
        },
        delete: { tags: ['Sessions'], summary: 'Delete session', responses: { '200': { description: 'Deleted' } } },
      },
      '/api/v1/agents/{agent_id}/sessions/{session_id}/messages': {
        parameters: [{ $ref: '#/components/parameters/agentId' }, { $ref: '#/components/parameters/sessionId' }, { $ref: '#/components/parameters/nodeId' }],
        get: { tags: ['Sessions'], summary: 'Chat history', responses: { '200': { description: 'Messages array' } } },
        post: {
          tags: ['Sessions'],
          summary: 'Send message',
          description: 'Enqueues a user message and triggers agent processing.',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { type: 'object', required: ['content'], properties: { content: { type: 'string' }, session_id: { type: 'string' } } },
              },
            },
          },
          responses: { '200': { description: 'Accepted' } },
        },
      },
      '/api/v1/agents/{agent_id}/sessions/{session_id}/stream': {
        parameters: [{ $ref: '#/components/parameters/agentId' }, { $ref: '#/components/parameters/sessionId' }, { $ref: '#/components/parameters/nodeId' }],
        get: {
          tags: ['Sessions'],
          summary: 'SSE stream',
          description:
            'Server-Sent Events stream for real-time agent responses. Connect with EventSource. Each event has a `data` field containing JSON with a `type` field (`delta`, `done`, `error`, etc.).',
          responses: {
            '200': {
              description: 'SSE stream',
              content: { 'text/event-stream': { schema: { type: 'string' } } },
            },
          },
        },
      },

      // ── Skills ───────────────────────────────────────────────────────────
      '/api/v1/skills': {
        get: {
          tags: ['Skills'],
          summary: 'List skills',
          parameters: [{ $ref: '#/components/parameters/nodeId' }],
          responses: { '200': { description: 'Skills list' } },
        },
      },
      '/api/v1/skills/{name}/enable': {
        parameters: [{ $ref: '#/components/parameters/skillName' }, { $ref: '#/components/parameters/nodeId' }],
        post: { tags: ['Skills'], summary: 'Enable skill', responses: { '200': { description: 'OK' } } },
      },
      '/api/v1/skills/{name}/disable': {
        parameters: [{ $ref: '#/components/parameters/skillName' }, { $ref: '#/components/parameters/nodeId' }],
        post: { tags: ['Skills'], summary: 'Disable skill', responses: { '200': { description: 'OK' } } },
      },

      // ── Schedules ────────────────────────────────────────────────────────
      '/api/v1/schedules': {
        parameters: [{ $ref: '#/components/parameters/nodeId' }],
        get: { tags: ['Schedules'], summary: 'List schedules', responses: { '200': { description: 'Schedules list' } } },
        post: {
          tags: ['Schedules'],
          summary: 'Create schedule',
          requestBody: { required: true, content: { 'application/json': { schema: { type: 'object' } } } },
          responses: { '200': { description: 'Created' } },
        },
      },
      '/api/v1/schedules/{id}': {
        parameters: [{ $ref: '#/components/parameters/scheduleId' }, { $ref: '#/components/parameters/nodeId' }],
        delete: { tags: ['Schedules'], summary: 'Delete schedule', responses: { '200': { description: 'Deleted' } } },
      },
      '/api/v1/schedules/{id}/toggle': {
        parameters: [{ $ref: '#/components/parameters/scheduleId' }, { $ref: '#/components/parameters/nodeId' }],
        post: { tags: ['Schedules'], summary: 'Toggle schedule active/paused', responses: { '200': { description: 'OK' } } },
      },

      // ── Node / System ─────────────────────────────────────────────────────
      '/api/v1/node': {
        get: {
          tags: ['Node'],
          summary: 'Node status',
          parameters: [{ $ref: '#/components/parameters/nodeId' }],
          responses: { '200': { description: 'Node info' } },
        },
      },
      '/api/v1/models': {
        get: {
          tags: ['Node'],
          summary: 'Available LLM models',
          parameters: [{ $ref: '#/components/parameters/nodeId' }],
          responses: { '200': { description: 'Models list' } },
        },
      },
    },
  };
}
