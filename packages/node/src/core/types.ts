export interface AdditionalMount {
  hostPath: string; // Absolute path on host (supports ~ for home)
  containerPath?: string; // Optional — defaults to basename of hostPath. Mounted at /workspace/extra/{value}
  readonly?: boolean; // Default: true for safety
}

/**
 * Mount Allowlist - Security configuration for additional mounts
 * This file should be stored at ~/.config/ticlaw/mount-allowlist.json
 * and is NOT mounted into any container, making it tamper-proof from agents.
 */
export interface MountAllowlist {
  // Directories that can be mounted into containers
  allowedRoots: AllowedRoot[];
  // Glob patterns for paths that should never be mounted (e.g., ".ssh", ".gnupg")
  blockedPatterns: string[];
  // If true, non-main agents can only mount read-only regardless of config
  nonMainReadOnly: boolean;
}

export interface AllowedRoot {
  // Absolute path or ~ for home (e.g., "~/projects", "/var/repos")
  path: string;
  // Whether read-write mounts are allowed under this root
  allowReadWrite: boolean;
  // Optional description for documentation
  description?: string;
}

/** Agent config for a room (chat). One agent can have multiple rooms across channels. */
export interface RegisteredProject {
  name: string;
  folder: string; // Agent folder (e.g. main, family-chat)
  trigger: string;
  added_at: string;
  agent_id?: string;

  requiresTrigger?: boolean; // Default: true for rooms, false for solo chats
  isMain?: boolean; // True for the main agent (no trigger, elevated privileges)
}

export interface AgentRecord {
  agent_id: string;
  name: string;
  created_at: string;
  updated_at: string;
}

export interface SessionRecord {
  session_id: string;
  agent_id: string;
  channel: string;
  source_ref?: string;
  status: 'active' | 'completed' | 'error';
  created_at: string;
  updated_at: string;
}

export interface SessionContext extends SessionRecord {
  task_id: string;
}

export type RunnerStatus = 'idle' | 'busy' | 'interrupted' | 'error';

export interface RunnerActivity {
  phase: string;
  action?: string;
  target?: string;
  elapsed_ms?: number;
}

export interface RunnerState {
  status: RunnerStatus;
  agent_id: string;
  session_id: string;
  task_id?: string;
  activity: RunnerActivity;
  recent_logs: string[];
}

export type TaskStatus =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'canceled'
  | 'timeout';

export type TaskFailureClassification =
  | 'tool_error'
  | 'input_error'
  | 'env_error'
  | 'permission_error'
  | 'internal_error';

export type TaskSource = 'acp' | 'api' | 'schedule' | 'http_run';

export interface TaskErrorInfo {
  classification: TaskFailureClassification;
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface TaskResultInfo {
  text?: string;
  details?: Record<string, unknown>;
}

/** In-memory task execution record (not persisted in DB). */
export interface TaskRecord {
  id: string;
  agent_id: string;
  session_id: string;
  source: TaskSource;
  source_ref?: string;
  prompt: string;
  submitted_by: string;
  submitter_type: string;
  idempotency_key?: string;
  required_capabilities: string[];
  status: TaskStatus;
  timeout_ms: number;
  step_timeout_ms?: number;
  max_retries: number;
  retry_backoff_ms: number;
  attempt_count: number;
  next_attempt_at: string;
  last_activity_at?: string;
  cancel_requested_at?: string;
  canceled_by?: string;
  result?: TaskResultInfo;
  error?: TaskErrorInfo;
  metadata?: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  started_at?: string;
  finished_at?: string;
}

export interface CreateTaskInput {
  id?: string;
  agent_id: string;
  session_id: string;
  prompt: string;
  source: TaskSource;
  source_ref?: string;
  submitted_by: string;
  submitter_type: string;
  idempotency_key?: string;
  required_capabilities?: string[];
  timeout_ms?: number;
  step_timeout_ms?: number;
  max_retries?: number;
  retry_backoff_ms?: number;
  metadata?: Record<string, unknown>;
}

export interface ScheduleRecord {
  id: string;
  agent_id: string;
  cron: string;
  prompt: string;
  type?: 'cron' | 'one-shot';
  session?: 'main' | 'isolated';
  status: 'active' | 'paused';
  target_jid?: string;
  delete_after_run?: boolean;
  next_run: string | null;
  last_run?: string | null;
  created_at: string;
}

export interface Attachment {
  type: 'image' | 'video' | 'audio' | 'file';
  url?: string;
  base64?: string;
  mime_type?: string;
  filename?: string;
  size?: number;
}

export interface NewMessage {
  id: string;
  chat_jid: string;
  sender: string;
  sender_name: string;
  content: string;
  timestamp: string;
  is_from_me?: boolean;
  is_bot_message?: boolean;
  agent_id?: string;
  session_id?: string;
  task_id?: string;
  attachments?: Attachment[];
}

export interface AvailableProject {
  jid: string;
  name: string;
  lastActivity: string;
  isRegistered: boolean;
}

// --- Channel abstraction ---

export interface Channel {
  name: string;
  connect(): Promise<void>;
  sendMessage(
    jid: string,
    text: string,
    options?: { embeds?: any[]; card?: any; message_id?: string },
  ): Promise<void>;
  sendFile(jid: string, filePath: string, caption?: string): Promise<void>;
  isConnected(): boolean;
  ownsJid(jid: string): boolean;
  disconnect(): Promise<void>;
  // Optional: typing indicator.
  setTyping?(jid: string, isTyping: boolean): Promise<void>;
  // Optional: sync group/chat names from the platform.
  syncGroups?(force: boolean): Promise<void>;
  // Optional: create a new channel in the same guild as fromJid.
  // Returns the new channel's JID, or null if not supported.
  createChannel?(fromJid: string, channelName: string): Promise<string | null>;
  // Optional: check if a channel/JID still exists on the platform.
  channelExists?(jid: string): Promise<boolean>;
  // Optional: send a message and return the platform message ID for later editing.
  sendMessageReturningId?(jid: string, text: string): Promise<string | null>;
  // Optional: edit an existing message by its platform message ID.
  editMessage?(jid: string, messageId: string, text: string): Promise<void>;
}

// Callback type that channels use to deliver inbound messages
export type OnInboundMessage = (chatJid: string, message: NewMessage) => void;

// Callback for chat metadata discovery.
// name is optional — channels that deliver names inline (Telegram) pass it here;
// channels that sync names separately (via syncGroups) omit it.
export type OnChatMetadata = (
  chatJid: string,
  timestamp: string,
  name?: string,
  channel?: string,
  isGroup?: boolean,
) => void;

/**
 * Common configuration passed to all channel factories.
 */
export interface ChannelOpts {
  onMessage: OnInboundMessage;
  onChatMetadata: OnChatMetadata;
  registeredProjects: () => Record<string, RegisteredProject>;
  onGroupRegistered?: (jid: string, group: RegisteredProject) => void;
}

export interface ContainerOutput {
  status: 'success' | 'error';
  result: string | null;
  error?: string;
  newSessionId?: string;
}

// --- Mind System schemas ---

export type InteractionRole = 'user' | 'assistant' | 'system';
export type InteractionIntent =
  | 'task'
  | 'persona'
  | 'memory'
  | 'mixed'
  | 'unknown';

export interface InteractionEvent {
  id: string;
  chat_jid: string;
  channel?: string;
  role: InteractionRole;
  content: string;
  timestamp: string;
  sender?: string;
  sender_name?: string;
  intent?: InteractionIntent;
  is_admin?: boolean;
  metadata?: Record<string, unknown>;
}

export type MindLifecycle = 'draft' | 'candidate' | 'locked';

export interface MindPersona {
  tone?: 'neutral' | 'friendly' | 'playful' | 'professional';
  verbosity?: 'short' | 'normal' | 'detailed';
  emoji?: boolean;
  styleNotes?: string[];
}

export interface MindState {
  id: string;
  version: number;
  lifecycle: MindLifecycle;
  persona: MindPersona;
  memory_summary: string;
  updated_at: string;
}

export interface MindPackage {
  id: string;
  version: number;
  lifecycle: MindLifecycle;
  persona: MindPersona;
  memory_summary: string;
  changelog: string;
  created_at: string;
}
