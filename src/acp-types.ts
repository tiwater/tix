export type ACPRole = 'system' | 'user' | 'assistant' | 'tool';

export type ACPContentType = 'text' | 'markdown' | 'artifact';

export interface ACPTextContentPart {
  type: 'text' | 'markdown';
  text: string;
}

export interface ACPArtifactContentPart {
  type: 'artifact';
  name?: string;
  mime_type?: string;
  uri?: string;
  path?: string;
  description?: string;
  data?: string;
}

export type ACPContentPart = ACPTextContentPart | ACPArtifactContentPart;

export interface ACPToolCall {
  id: string;
  name: string;
  arguments?: Record<string, unknown>;
}

export interface ACPToolResult {
  tool_call_id: string;
  name?: string;
  result?: unknown;
  is_error?: boolean;
}

export interface ACPMessageEnvelope {
  id: string;
  role: ACPRole;
  content: ACPContentPart[];
  tool_calls?: ACPToolCall[];
  tool_results?: ACPToolResult[];
  metadata?: Record<string, unknown>;
  created_at: string;
}

export interface ACPSessionDescriptor {
  id: string;
  thread_id: string;
  runtime_id: string;
  agent_id: string;
  session_id: string;
  chat_jid: string;
  created_at: string;
  updated_at: string;
  stream_url: string;
  message_url: string;
  tools_url: string;
}

export interface ACPAgentManifest {
  id: string;
  protocol: 'acp';
  name: string;
  description: string;
  version: string;
  runtime_id: string;
  agent_id: string;
  endpoints: {
    agents: string;
    sessions: string;
  };
  capabilities: {
    streaming: boolean;
    inbound: boolean;
    outbound: boolean;
    tool_calls: boolean;
    tool_results: boolean;
    content_types: ACPContentType[];
  };
}

export interface ACPCreateSessionRequest {
  runtime_id?: string;
  agent_id: string;
  session_id?: string;
  thread_id?: string;
  metadata?: Record<string, unknown>;
  message?: Partial<ACPMessageEnvelope>;
}

export interface ACPSendMessageRequest {
  message: Partial<ACPMessageEnvelope>;
}

export interface ACPToolCallRequest {
  tool_calls: ACPToolCall[];
  content?: string | ACPContentPart[];
  metadata?: Record<string, unknown>;
}

export interface ACPStreamEvent {
  type:
    | 'session'
    | 'message'
    | 'message.delta'
    | 'job'
    | 'tool_call'
    | 'tool_result'
    | 'error'
    | 'heartbeat';
  session_id: string;
  job_id?: string;
  message?: ACPMessageEnvelope;
  tool_calls?: ACPToolCall[];
  tool_results?: ACPToolResult[];
  data?: Record<string, unknown>;
  error?: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}
