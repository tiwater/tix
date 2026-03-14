import fs from 'fs';
import path from 'path';
import { query } from '@anthropic-ai/claude-agent-sdk';
import type {
  Query,
  SDKResultMessage,
  SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk';
import { logger } from './logger.js';
import {
  AGENT_MIND_FILES,
  ASSISTANT_NAME,
  DEFAULT_LLM_MODEL,
  ANTHROPIC_API_KEY,
  LLM_API_KEY,
  LLM_BASE_URL,
  SKILLS_CONFIG,
  agentPaths,
  TICLAW_HOME,
} from './config.js';
import { getSession } from './store.js';
import { createRequire } from 'module';
import { SkillsRegistry } from '../skills/registry.js';
import type {
  SessionContext,
  RunnerState,
  RunnerStatus,
  RunnerActivity,
} from './types.js';
import { randomUUID, type UUID } from 'crypto';

const require = createRequire(import.meta.url);

// ── Cached CLI path (resolved once) ──
let _cachedCliPath: string | null = null;

function getClaudeCliPath(): string {
  if (_cachedCliPath !== null) return _cachedCliPath;

  try {
    const sdkEntry = require.resolve('@anthropic-ai/claude-agent-sdk');
    const sdkDir = path.dirname(sdkEntry);
    const cliPath = path.join(sdkDir, 'cli.js');
    if (fs.existsSync(cliPath)) {
      logger.debug({ cliPath }, 'Claude CLI found (cached)');
      _cachedCliPath = cliPath;
      return cliPath;
    }
  } catch (e: any) {
    logger.debug({ err: e.message }, 'require.resolve fallback failed');
  }

  const cwdPath = path.join(
    process.cwd(),
    'node_modules/@anthropic-ai/claude-agent-sdk/cli.js',
  );
  if (fs.existsSync(cwdPath)) {
    logger.debug({ cliPath: cwdPath }, 'Claude CLI found via cwd (cached)');
    _cachedCliPath = cwdPath;
    return cwdPath;
  }

  logger.error('Claude Agent SDK cli.js not found');
  _cachedCliPath = '';
  return '';
}

// ── Cached system prompts (per agent, invalidated by mtime) ──
const _promptCache = new Map<string, { prompt: string; mtimeKey: string }>();

function getPromptMtimeKey(baseDir: string): string {
  let key = '';
  for (const filename of AGENT_MIND_FILES) {
    const p = path.join(baseDir, filename);
    try {
      const stat = fs.statSync(p);
      key += `${filename}:${stat.mtimeMs};`;
    } catch {
      key += `${filename}:0;`;
    }
  }
  const memoryDir = path.join(baseDir, 'memory');
  try {
    const stat = fs.statSync(memoryDir);
    key += `memory:${stat.mtimeMs}`;
  } catch {
    key += 'memory:0';
  }
  return key;
}

// ══════════════════════════════════════════════════════════════
// Warm Session Pool — keeps SDK subprocesses alive between msgs
// ══════════════════════════════════════════════════════════════

interface WarmSession {
  query: Query;
  agentId: string;
  sessionId: string;
  createdAt: number;
  lastUsedAt: number;
  /** Whether the background output loop is still running. */
  alive: boolean;
}

/**
 * Handlers for the currently-active run on a warm session.
 * Set before sending a message; cleared when 'result' is received.
 */
interface ActiveHandler {
  onEvent: (event: any, elapsed: number) => Promise<void>;
  onResult: (event: any) => void;
  startTime: number;
  textParts: string[];
  resolve: () => void;
  reject: (err: Error) => void;
}

const warmSessions = new Map<string, WarmSession>();
const activeHandlers = new Map<string, ActiveHandler>();

// TTL: close idle sessions after 10 minutes
const WARM_SESSION_TTL = 10 * 60 * 1000;

// Periodic cleanup of idle sessions
setInterval(() => {
  const now = Date.now();
  for (const [key, session] of warmSessions) {
    if (now - session.lastUsedAt > WARM_SESSION_TTL) {
      logger.info({ key }, 'Closing idle warm session');
      try {
        session.query.close();
      } catch {}
      warmSessions.delete(key);
      activeHandlers.delete(key);
    }
  }
}, 60_000);

function buildSessionKey(agentId: string, sessionId: string): string {
  return `${agentId}:${sessionId}`;
}

function buildQueryOptions(
  systemPrompt: string,
  workspace: string,
  agentId: string,
  sessionId: string,
  taskId: string,
) {
  const cliPath = getClaudeCliPath();

  // Resolve API key: prefer dedicated ANTHROPIC_API_KEY, fall back to LLM_API_KEY
  const effectiveApiKey = ANTHROPIC_API_KEY || LLM_API_KEY || '';
  const effectiveBaseUrl = LLM_BASE_URL || '';

  if (!effectiveApiKey) {
    logger.warn('No API key configured (ANTHROPIC_API_KEY or LLM_API_KEY)');
  } else {
    logger.debug(
      {
        keyPrefix: effectiveApiKey.slice(0, 8) + '…',
        hasBaseUrl: !!effectiveBaseUrl,
      },
      'Agent subprocess API key configured',
    );
  }

  return {
    systemPrompt,
    cwd: workspace,
    allowedTools: ['Read', 'Edit', 'Bash', 'Glob', 'Grep', 'Write'],
    permissionMode: 'acceptEdits' as const,
    model: DEFAULT_LLM_MODEL,
    settingSources: [] as any[],
    includePartialMessages: true,
    pathToClaudeCodeExecutable: cliPath,
    persistSession: false,
    env: {
      ...process.env,
      ANTHROPIC_API_KEY: effectiveApiKey,
      ...(effectiveBaseUrl ? { ANTHROPIC_BASE_URL: effectiveBaseUrl } : {}),
      TICLAW_AGENT_ID: agentId,
      TICLAW_SESSION_ID: sessionId,
      TICLAW_TASK_ID: taskId,
    } as Record<string, string>,
  };
}

/**
 * Start the background output loop for a warm session.
 * Reads from the query's async iterable and dispatches to the active handler.
 */
function startOutputLoop(key: string, warm: WarmSession): void {
  (async () => {
    try {
      for await (const msg of warm.query) {
        const handler = activeHandlers.get(key);
        if (!handler) continue; // No active run — skip (shouldn't happen)

        const event = msg as any;
        await handler.onEvent(event, Date.now() - handler.startTime);

        if (event.type === 'assistant') {
          const blocks = event.message?.content || [];
          for (const block of blocks) {
            if (block.type === 'text' && block.text) {
              handler.textParts.push(block.text);
            }
          }
        }

        if (event.type === 'result') {
          handler.onResult(event);
        }
      }
    } catch (err: any) {
      logger.debug({ key, err: err.message }, 'Warm session output loop ended');
      const handler = activeHandlers.get(key);
      if (handler) {
        handler.reject(err);
        activeHandlers.delete(key);
      }
    } finally {
      warm.alive = false;
      warmSessions.delete(key);
    }
  })();
}

// ══════════════════════════════════════════════════════════════
// AgentRunner — Public API (unchanged interface)
// ══════════════════════════════════════════════════════════════

export interface RunnerEvents {
  onStateChange?: (state: RunnerState) => void | Promise<void>;
  onReply?: (text: string) => void | Promise<void>;
}

/**
 * AgentRunner: The refined functional "Body" of a TiClaw Agent.
 * Keeps SDK subprocesses alive between messages for faster responses.
 *
 * - First message: spawns subprocess with the real prompt (cold start)
 * - Subsequent messages: reuses the warm subprocess via streamInput()
 */
export class AgentRunner {
  private state: RunnerState;
  private controller: AbortController | null = null;
  private events: RunnerEvents;

  constructor(agentId: string, sessionId: string, events: RunnerEvents = {}) {
    this.events = events;
    this.state = {
      status: 'idle',
      agent_id: agentId,
      session_id: sessionId,
      activity: { phase: 'idle' },
      recent_logs: [],
    };
  }

  public getState(): RunnerState {
    return { ...this.state };
  }

  /**
   * Primary entry point: Executes a user message through the Agent Loop.
   * First call spawns the subprocess; subsequent calls reuse it via streamInput().
   */
  async run(message: string, taskId?: string): Promise<void> {
    if (this.state.status === 'busy') {
      throw new Error(
        `Runner ${this.state.agent_id}:${this.state.session_id} is already busy.`,
      );
    }

    this.state.task_id = taskId || `task-${Date.now()}`;
    this.state.status = 'busy';
    this.state.recent_logs = [];
    this.controller = new AbortController();

    const session = getSession(this.state.session_id) as SessionContext;
    if (!session) {
      this.state.status = 'error';
      throw new Error(`Session ${this.state.session_id} not found.`);
    }

    const paths = agentPaths(this.state.agent_id);
    this.initBrain(paths.base, paths.workspace);

    logger.info(
      { agent_id: this.state.agent_id, task_id: this.state.task_id },
      'AgentRunner: Starting task loop',
    );
    await this.notifyState();

    const key = buildSessionKey(this.state.agent_id, this.state.session_id);

    try {
      const systemPrompt = this.preparePrompt(paths.base);
      const warm = warmSessions.get(key);
      const isWarm = warm?.alive === true;

      // Set up result handler BEFORE sending message
      const resultPromise = new Promise<void>((resolve, reject) => {
        const handler: ActiveHandler = {
          startTime: Date.now(),
          textParts: [],
          resolve,
          reject,
          onEvent: async (event: any, elapsed: number) => {
            await this.handleExecutorEvent(event, elapsed);
          },
          onResult: (event: any) => {
            const finalText =
              event.result?.trim() ||
              handler.textParts.join('\n').trim() ||
              '(done)';
            this.events.onReply?.(finalText);
            this.consolidateMemory(paths.base, finalText);
            activeHandlers.delete(key);
            resolve();
          },
        };
        activeHandlers.set(key, handler);
      });

      // Handle AbortSignal
      const abortHandler = () => {
        const handler = activeHandlers.get(key);
        if (handler) {
          activeHandlers.delete(key);
          handler.reject(new Error('aborted'));
        }
      };
      this.controller.signal.addEventListener('abort', abortHandler, {
        once: true,
      });

      if (isWarm) {
        // ── Warm path: reuse existing subprocess via streamInput() ──
        logger.info({ key }, 'AgentRunner: Warm path — reusing subprocess');
        warm!.lastUsedAt = Date.now();

        const userMsg: SDKUserMessage = {
          type: 'user',
          message: { role: 'user', content: message },
          parent_tool_use_id: null,
          session_id: warm!.sessionId,
          uuid: randomUUID() as UUID,
        };
        await warm!.query.streamInput(
          (async function* () {
            yield userMsg;
          })(),
        );
      } else {
        // ── Cold path: spawn new subprocess with the actual message ──
        logger.info({ key }, 'AgentRunner: Cold start — spawning subprocess');

        // Clean up stale session if any
        if (warm) {
          try {
            warm.query.close();
          } catch {}
          warmSessions.delete(key);
        }

        const opts = buildQueryOptions(
          systemPrompt,
          paths.workspace,
          this.state.agent_id,
          this.state.session_id,
          this.state.task_id!,
        );

        const agentQuery = query({
          prompt: message,
          options: opts,
        });

        const newWarm: WarmSession = {
          query: agentQuery as Query,
          agentId: this.state.agent_id,
          sessionId: this.state.session_id,
          createdAt: Date.now(),
          lastUsedAt: Date.now(),
          alive: true,
        };
        warmSessions.set(key, newWarm);

        // Start the output loop (runs in background, survives this run() call)
        startOutputLoop(key, newWarm);
      }

      // Wait for the result
      await resultPromise;

      this.state.status = 'idle';
      this.state.activity = { phase: 'done' };
    } catch (err: any) {
      if (this.controller?.signal.aborted) {
        this.state.status = 'interrupted';
        this.state.activity = { phase: 'interrupted' };
      } else {
        this.state.status = 'error';
        this.state.activity = { phase: 'error', action: err.message };
        logger.error(
          { err, agent_id: this.state.agent_id },
          'AgentRunner: Loop failed',
        );
        // Clean up broken warm session
        const warm = warmSessions.get(key);
        if (warm) {
          try {
            warm.query.close();
          } catch {}
          warmSessions.delete(key);
          activeHandlers.delete(key);
        }
      }
    } finally {
      this.controller = null;
      await this.notifyState();
    }
  }

  /**
   * Preemptively stop the current task.
   */
  interrupt(): void {
    if (this.controller && this.state.status === 'busy') {
      this.controller.abort();
    }
  }

  /**
   * Initializes the "Brain" directory structure and essential files.
   */
  private initBrain(baseDir: string, workspaceDir: string): void {
    if (!fs.existsSync(baseDir)) fs.mkdirSync(baseDir, { recursive: true });
    if (!fs.existsSync(workspaceDir))
      fs.mkdirSync(workspaceDir, { recursive: true });

    const memoryDir = path.join(baseDir, 'memory');
    if (!fs.existsSync(memoryDir)) fs.mkdirSync(memoryDir, { recursive: true });

    for (const filename of AGENT_MIND_FILES) {
      const p = path.join(baseDir, filename);
      if (!fs.existsSync(p)) {
        fs.writeFileSync(
          p,
          `# ${filename.replace('.md', '')}\n\nInitialized.\n`,
          'utf-8',
        );
      }
    }
  }

  /**
   * Builds the system prompt with caching (invalidated by mtime).
   */
  private preparePrompt(baseDir: string): string {
    const mtimeKey = getPromptMtimeKey(baseDir);
    const cached = _promptCache.get(this.state.agent_id);
    if (cached && cached.mtimeKey === mtimeKey) {
      logger.debug(
        { agent_id: this.state.agent_id },
        'Using cached system prompt',
      );
      return cached.prompt;
    }

    const parts: string[] = [
      `You are ${ASSISTANT_NAME}. Work strictly within your assigned workspace.`,
      `Your core persona and memory are defined in the following Markdown files.`,
    ];

    for (const filename of AGENT_MIND_FILES) {
      const p = path.join(baseDir, filename);
      if (fs.existsSync(p)) {
        const content = fs.readFileSync(p, 'utf-8').trim();
        if (content) parts.push(`### ${filename}\n${content}`);
      }
    }

    const memoryDir = path.join(baseDir, 'memory');
    if (fs.existsSync(memoryDir)) {
      const journals = fs
        .readdirSync(memoryDir)
        .filter((f) => f.endsWith('.md'))
        .sort()
        .reverse()
        .slice(0, 3);

      if (journals.length > 0) {
        parts.push('## Recent Journal (Chronological Memory)');
        for (const j of journals) {
          const content = fs
            .readFileSync(path.join(memoryDir, j), 'utf-8')
            .trim();
          parts.push(`### Date: ${j.replace('.md', '')}\n${content}`);
        }
      }
    }

    const prompt = parts.join('\n\n---\n\n');
    _promptCache.set(this.state.agent_id, { prompt, mtimeKey });
    return prompt;
  }

  /**
   * Maps Executor (Claude SDK) events to internal Telemetry State.
   */
  private async handleExecutorEvent(
    event: Record<string, any>,
    elapsed: number,
  ): Promise<void> {
    const type = event.type as string;
    this.state.activity.phase = event.phase || type;
    this.state.activity.elapsed_ms = elapsed;

    if (type === 'assistant') {
      const tool = (event.message?.content || []).find(
        (b: any) => b.type === 'tool_use',
      );
      if (tool) {
        this.state.activity.action = `executing_${tool.name}`;
        this.state.activity.target = JSON.stringify(tool.input);
      } else {
        this.state.activity.action = 'thinking';
      }
    } else if (type === 'stream_event' && event.event?.delta?.text) {
      this.state.activity.action = 'speaking';
      this.state.activity.target = event.event.delta.text;
    }

    const logLine = `[${this.state.activity.phase}] ${this.state.activity.action || ''}`;
    this.state.recent_logs.push(logLine);
    if (this.state.recent_logs.length > 15) this.state.recent_logs.shift();

    await this.notifyState();
  }

  /**
   * Automatically consolidates task results into an asynchronous journal.
   */
  private async consolidateMemory(
    baseDir: string,
    result: string,
  ): Promise<void> {
    const today = new Date().toISOString().split('T')[0];
    const journalPath = path.join(baseDir, 'memory', `${today}.md`);
    const entry = `\n- [${new Date().toLocaleTimeString()}] Task: ${this.state.task_id}\n  Result: ${result.slice(0, 200)}...\n`;
    fs.appendFileSync(journalPath, entry, 'utf-8');
  }

  private async notifyState(): Promise<void> {
    if (this.events.onStateChange)
      await this.events.onStateChange(this.getState());
  }
}
