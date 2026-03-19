/**
 * TiClaw Node — declarative route registry.
 *
 * This is the single source of truth for all HTTP routes. Both:
 *   1. The OpenAPI spec (GET /api/v1/openapi.json) is generated from here.
 *   2. Route matching in http.ts can reference ROUTES for consistency.
 *
 * Adding a new endpoint? Add an entry here. The spec updates automatically.
 */

export interface RouteParam {
  name: string;
  in: 'path' | 'query' | 'header';
  required?: boolean;
  type?: string;
  description?: string;
}

export interface RouteBody {
  description?: string;
  required?: boolean;
  /** Simplified JSON schema for the request body. */
  schema: Record<string, unknown>;
}

export interface RouteDef {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;           // OpenAPI path template, e.g. /api/v1/agents/{agent_id}
  tag: string;
  summary: string;
  description?: string;
  params?: RouteParam[];
  body?: RouteBody;
  /** Simplified response description. */
  response?: string;
}

// Common reusable params
const agentId: RouteParam     = { name: 'agent_id',   in: 'path', required: true,  type: 'string' };
const sessionId: RouteParam   = { name: 'session_id', in: 'path', required: true,  type: 'string' };
const scheduleId: RouteParam  = { name: 'id',         in: 'path', required: true,  type: 'string' };
const skillName: RouteParam   = { name: 'name',       in: 'path', required: true,  type: 'string' };

export const ROUTES: RouteDef[] = [
  // ── Node ────────────────────────────────────────────────────────────────
  { method: 'GET',    path: '/health',                                     tag: 'Node',      summary: 'Health check' },
  { method: 'GET',    path: '/api/v1/node',                                tag: 'Node',      summary: 'Node status and identity' },
  { method: 'POST',   path: '/api/v1/node/trust',                          tag: 'Node',      summary: 'Mark node as trusted' },
  { method: 'GET',    path: '/api/v1/models',                              tag: 'Node',      summary: 'List available LLM models' },
  { method: 'GET',    path: '/api/v1/tasks',                               tag: 'Node',      summary: 'List active tasks' },

  // ── Agents ──────────────────────────────────────────────────────────────
  { method: 'GET',    path: '/api/v1/agents',                              tag: 'Agents',    summary: 'List agents' },
  { method: 'POST',   path: '/api/v1/agents',                              tag: 'Agents',    summary: 'Create agent',
    body: { required: true, schema: { type: 'object', required: ['id'], properties: { id: { type: 'string' }, name: { type: 'string' }, description: { type: 'string' } } } } },
  { method: 'GET',    path: '/api/v1/agents/{agent_id}',                   tag: 'Agents',    summary: 'Get agent config', params: [agentId] },
  { method: 'PATCH',  path: '/api/v1/agents/{agent_id}',                   tag: 'Agents',    summary: 'Update agent config', params: [agentId],
    body: { required: true, schema: { type: 'object' } } },
  { method: 'DELETE', path: '/api/v1/agents/{agent_id}',                   tag: 'Agents',    summary: 'Delete agent', params: [agentId] },
  { method: 'GET',    path: '/api/v1/agents/{agent_id}/mind',              tag: 'Agents',    summary: 'Get agent mind files', params: [agentId] },
  { method: 'GET',    path: '/api/v1/agents/{agent_id}/artifacts',         tag: 'Agents',    summary: 'List agent artifacts', params: [agentId] },
  { method: 'GET',    path: '/api/v1/agents/{agent_id}/memory',            tag: 'Agents',    summary: 'Get agent memory roll', params: [agentId] },
  { method: 'POST',   path: '/api/v1/agents/{agent_id}/workspace/upload',  tag: 'Agents',    summary: 'Upload file to workspace', params: [agentId] },

  // ── Sessions ─────────────────────────────────────────────────────────────
  { method: 'GET',    path: '/api/v1/agents/{agent_id}/sessions',                              tag: 'Sessions', summary: 'List sessions', params: [agentId] },
  { method: 'POST',   path: '/api/v1/agents/{agent_id}/sessions',                              tag: 'Sessions', summary: 'Create session', params: [agentId],
    body: { schema: { type: 'object', properties: { title: { type: 'string' } } } } },
  { method: 'GET',    path: '/api/v1/agents/{agent_id}/sessions/{session_id}',                 tag: 'Sessions', summary: 'Get session', params: [agentId, sessionId] },
  { method: 'PATCH',  path: '/api/v1/agents/{agent_id}/sessions/{session_id}',                 tag: 'Sessions', summary: 'Update session title', params: [agentId, sessionId],
    body: { required: true, schema: { type: 'object', properties: { title: { type: 'string' } } } } },
  { method: 'DELETE', path: '/api/v1/agents/{agent_id}/sessions/{session_id}',                 tag: 'Sessions', summary: 'Delete session', params: [agentId, sessionId] },
  { method: 'GET',    path: '/api/v1/agents/{agent_id}/sessions/{session_id}/messages',        tag: 'Sessions', summary: 'Chat history', params: [agentId, sessionId] },
  { method: 'POST',   path: '/api/v1/agents/{agent_id}/sessions/{session_id}/messages',        tag: 'Sessions', summary: 'Send message', params: [agentId, sessionId],
    body: { required: true, schema: { type: 'object', required: ['content'], properties: { content: { type: 'string' } } } } },
  { method: 'GET',    path: '/api/v1/agents/{agent_id}/sessions/{session_id}/stream',          tag: 'Sessions', summary: 'SSE stream',
    description: 'Real-time Server-Sent Events stream for agent responses. Use EventSource. Events: delta, done, error.',
    params: [agentId, sessionId], response: 'text/event-stream' },

  // ── Skills ───────────────────────────────────────────────────────────────
  { method: 'GET',    path: '/api/v1/skills',                              tag: 'Skills',    summary: 'List skills' },
  { method: 'GET',    path: '/api/v1/skills/{name}',                       tag: 'Skills',    summary: 'Get skill details', params: [skillName] },
  { method: 'POST',   path: '/api/v1/skills/{name}/enable',                tag: 'Skills',    summary: 'Enable skill', params: [skillName] },
  { method: 'POST',   path: '/api/v1/skills/{name}/disable',               tag: 'Skills',    summary: 'Disable skill', params: [skillName] },

  // ── Schedules ────────────────────────────────────────────────────────────
  { method: 'GET',    path: '/api/v1/schedules',                           tag: 'Schedules', summary: 'List schedules' },
  { method: 'POST',   path: '/api/v1/schedules',                           tag: 'Schedules', summary: 'Create schedule',
    body: { required: true, schema: { type: 'object' } } },
  { method: 'DELETE', path: '/api/v1/schedules/{id}',                      tag: 'Schedules', summary: 'Delete schedule', params: [scheduleId] },
  { method: 'POST',   path: '/api/v1/schedules/{id}/toggle',               tag: 'Schedules', summary: 'Toggle active/paused', params: [scheduleId] },
  { method: 'POST',   path: '/api/v1/schedules/refresh',                   tag: 'Schedules', summary: 'Force schedule check' },

  // ── Enrollment ───────────────────────────────────────────────────────────
  { method: 'GET',    path: '/api/v1/enroll/status',                       tag: 'Enrollment', summary: 'Enrollment status' },
  { method: 'POST',   path: '/api/v1/enroll/token',                        tag: 'Enrollment', summary: 'Issue enrollment token' },
  { method: 'POST',   path: '/api/v1/enroll/verify',                       tag: 'Enrollment', summary: 'Verify enrollment token' },
];

/** Build an OpenAPI 3.0 paths object from ROUTES. */
export function buildNodePaths(): Record<string, unknown> {
  const paths: Record<string, Record<string, unknown>> = {};

  for (const route of ROUTES) {
    if (!paths[route.path]) paths[route.path] = {};

    const op: Record<string, unknown> = {
      tags: [route.tag],
      summary: route.summary,
    };
    if (route.description) op.description = route.description;

    const parameters = (route.params ?? []).map((p) => ({
      name: p.name,
      in: p.in,
      required: p.required ?? true,
      schema: { type: p.type ?? 'string' },
      ...(p.description ? { description: p.description } : {}),
    }));
    if (parameters.length) op.parameters = parameters;

    if (route.body) {
      op.requestBody = {
        required: route.body.required ?? false,
        content: { 'application/json': { schema: route.body.schema } },
      };
    }

    const responseContent = route.response === 'text/event-stream'
      ? { 'text/event-stream': { schema: { type: 'string' } } }
      : { 'application/json': { schema: { type: 'object' } } };

    op.responses = { '200': { description: 'OK', content: responseContent } };

    paths[route.path][route.method.toLowerCase()] = op;
  }

  return paths;
}

/** Full OpenAPI spec for the node's HTTP API. */
export function buildNodeOpenApiSpec(opts: { serverUrl?: string } = {}): object {
  return {
    openapi: '3.0.3',
    info: {
      title: 'TiClaw Node API',
      version: '1.0.0',
      description: 'HTTP API served by a TiClaw Node. Normally accessed via the Gateway relay.',
    },
    servers: [{ url: opts.serverUrl || 'http://localhost:2756', description: 'TiClaw Node' }],
    security: [{ apiKey: [] }],
    components: {
      securitySchemes: {
        apiKey: {
          type: 'apiKey',
          in: 'header',
          name: 'X-API-Key',
          description: 'Set via HTTP_API_KEY env var on the node.',
        },
      },
    },
    paths: buildNodePaths(),
  };
}
