import { type ModelEntry } from './env.js';
export type { ModelEntry };
export declare const ASSISTANT_NAME: string;
export declare const ASSISTANT_HAS_OWN_NUMBER: boolean;
/** Workspace skill CLI: gemini, codex, claude, etc. Used only when agent needs to run code. */
export declare const TIX_CODING_CLI: string;
export declare const MIND_ADMIN_USERS: string[];
export declare const MIND_LOCK_MODE: string;
export declare const POLL_INTERVAL = 2000;
export declare const SCHEDULER_POLL_INTERVAL = 60000;
export declare let TIX_HOME: string;
export declare function expandHomePath(inputPath: string): string;
export declare let MOUNT_ALLOWLIST_PATH: string;
export declare let STORE_DIR: string;
export declare let AGENTS_DIR: string;
export declare let DATA_DIR: string;
export declare let SKILLS_HOME: string;
export declare let SKILLS_STATE_PATH: string;
export declare let SKILLS_AUDIT_LOG_PATH: string;
export declare function configureTixComputer(options: {
    dataDir?: string;
}): void;
export declare function initializeDataDirs(): void;
export declare const SECURITY_TRUSTED_REMOTE_HOSTS: string[];
export declare const SECURITY_ALLOW_INSECURE_REMOTE_ENDPOINTS: boolean;
export declare const WORKSPACE_ALLOWED_ROOTS: string[];
export declare const CHILD_ENV_ALLOWLIST: string[];
/** OpenTix-compatible mind files (boot-md order). Evolved through conversation. */
export declare const AGENT_MIND_FILES: readonly ["SOUL.md", "IDENTITY.md", "USER.md", "MEMORY.md"];
/** Legacy: single memory file (pre–OpenTix split). Kept for migration. */
export declare const AGENT_MEMORY_FILENAME = "MEMORY.md";
export interface SkillsRuntimeConfig {
    directories: string[];
    adminOnly: boolean;
    allowLevel3: boolean;
    autoEnableOnInstall: boolean;
    defaultEnabled: string[];
    statePath: string;
    auditLogPath: string;
}
export declare const SKILLS_CONFIG: SkillsRuntimeConfig;
export declare const CONTAINER_IMAGE: string;
export declare const CONTAINER_TIMEOUT: number;
export declare const CONTAINER_MAX_OUTPUT_SIZE: number;
export declare const IPC_POLL_INTERVAL = 1000;
export declare const IDLE_TIMEOUT: number;
export declare const MAX_CONCURRENT_CONTAINERS: number;
export declare const TRIGGER_PATTERN: RegExp;
export declare const TIMEZONE: string;
export declare const HTTP_PORT: number;
export declare const HTTP_ENABLED: boolean;
export declare const HTTP_API_KEY: string;
export declare const TIX_AUTH_TOKEN: string;
export declare const WORKSPACE_ROOT: string;
export declare const ALLOWED_ORIGINS: string;
/**
 * Get pricing for a model entry.
 * Priority: 1) explicit config.yaml pricing, 2) provider-specific built-in, 3) global fallback.
 */
export declare function getModelPricing(entry: ModelEntry): {
    input: number;
    output: number;
};
export declare const MODELS_REGISTRY: ModelEntry[];
/** The default model entry (marked default:true, or first in list). */
export declare const DEFAULT_MODEL: ModelEntry | undefined;
export declare const COMPUTER_HOSTNAME: string;
/** Product branding name (e.g. "Supen", "Ticos"). Defaults to "Supen". */
export declare const TIX_PRODUCT_NAME: string;
export declare const ACP_ENABLED: boolean;
export declare const ACP_RELAY_URL: string;
export declare const CONCURRENCY_LIMIT: number;
export declare const AGENT_CONCURRENCY_LIMIT: number;
export declare const SESSION_CONCURRENCY_LIMIT: number;
export declare const TASK_DEFAULT_TIMEOUT_MS: number;
export declare const TASK_DEFAULT_STEP_TIMEOUT_MS: number;
export declare const TASK_DEFAULT_RETRY_COUNT: number;
export declare const TASK_DEFAULT_RETRY_BACKOFF_MS: number;
export declare function agentPaths(agentId: string): {
    base: string;
    config: string;
    workspace: string;
    logs: string;
    brain: string;
};
/**
 * Get the ordered list of models for a specific agent.
 *
 * 1. Checks `agent-config.json` for `model`: "provider_id:model_name" (composite key)
 * 2. If present, puts that model first, followed by the rest of the registry for fallback.
 * 3. If absent or invalid, returns the full registry (which puts the default model first).
 */
export declare function getAgentModelConfig(agentId: string, silent?: boolean): ModelEntry[];
//# sourceMappingURL=config.d.ts.map