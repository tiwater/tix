export interface AdditionalMount {
    hostPath: string;
    containerPath?: string;
    readonly?: boolean;
}
/**
 * Mount Allowlist - Security configuration for additional mounts
 * This file should be stored at ~/.config/tix/mount-allowlist.json
 * and is NOT mounted into any container, making it tamper-proof from agents.
 */
export interface MountAllowlist {
    allowedRoots: AllowedRoot[];
    blockedPatterns: string[];
    nonMainReadOnly: boolean;
}
export interface AllowedRoot {
    path: string;
    allowReadWrite: boolean;
    description?: string;
}
/** Agent config for a room (chat). One agent can have multiple rooms across channels. */
export interface RegisteredProject {
    name: string;
    folder: string;
    trigger: string;
    added_at: string;
    agent_id?: string;
    requiresTrigger?: boolean;
    isMain?: boolean;
}
export interface AgentRecord {
    agent_id: string;
    name: string;
    tags?: string[];
    created_at: string;
    updated_at: string;
    tokens_in?: number;
    tokens_out?: number;
}
export interface SessionRecord {
    session_id: string;
    agent_id: string;
    channel: string;
    source_ref?: string;
    title?: string;
    status: 'idle' | 'running' | 'error';
    tokens_in?: number;
    tokens_out?: number;
    archived?: boolean;
    created_at: string;
    updated_at: string;
}
export interface SessionContext extends SessionRecord {
    task_id: string;
}
export type ComputerStatus = 'idle' | 'busy' | 'interrupted' | 'error';
export interface ComputerActivity {
    phase: string;
    action?: string;
    target?: string;
    elapsed_ms?: number;
}
export interface ComputerState {
    status: ComputerStatus;
    agent_id: string;
    session_id: string;
    task_id?: string;
    activity: ComputerActivity;
    recent_logs: string[];
    last_activity_at?: number;
}
export type TaskStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled' | 'timeout';
export type TaskFailureClassification = 'tool_error' | 'input_error' | 'env_error' | 'permission_error' | 'internal_error';
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
    tokens_in?: number;
    tokens_out?: number;
    model?: string;
}
export interface AvailableProject {
    jid: string;
    name: string;
    lastActivity: string;
    isRegistered: boolean;
}
export interface Channel {
    name: string;
    connect(): Promise<void>;
    sendMessage(jid: string, text: string, options?: {
        embeds?: any[];
        card?: any;
        message_id?: string;
    }): Promise<void>;
    sendFile(jid: string, filePath: string, caption?: string): Promise<void>;
    isConnected(): boolean;
    ownsJid(jid: string): boolean;
    disconnect(): Promise<void>;
    setTyping?(jid: string, isTyping: boolean): Promise<void>;
    syncGroups?(force: boolean): Promise<void>;
    createChannel?(fromJid: string, channelName: string): Promise<string | null>;
    channelExists?(jid: string): Promise<boolean>;
    sendMessageReturningId?(jid: string, text: string): Promise<string | null>;
    editMessage?(jid: string, messageId: string, text: string): Promise<void>;
}
export type OnInboundMessage = (chatJid: string, message: NewMessage) => void;
export type OnChatMetadata = (chatJid: string, timestamp: string, name?: string, channel?: string, isGroup?: boolean) => void;
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
export type InteractionRole = 'user' | 'assistant' | 'system';
export type InteractionIntent = 'task' | 'persona' | 'memory' | 'mixed' | 'unknown';
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
//# sourceMappingURL=types.d.ts.map