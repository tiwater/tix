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
    key += `memory:${stat.mtimeMs};`;
  } catch {
    key += 'memory:0;';
  }
  try {
    const stat = fs.statSync(SKILLS_CONFIG.statePath);
    key += `skills:${stat.mtimeMs}`;
  } catch {
    key += 'skills:0';
  }
  return key;
}

// ══════════════════════════════════════════════════════════════
// Warm Session Pool — keeps SDK subprocesses alive between msgs
// ══════════════════════════════════════════════════════════════
//
// Design principles:
//   • One warm subprocess per AGENT (not per channel session).
//     Key = agentId only, so CLI / web / Feishu all reuse the same process.
//   • Handler is registered BEFORE startOutputLoop so no events are dropped.
//   • streamInput() failure gracefully falls back to a cold resume.
//   • Claude SDK session ID captured from the earliest possible event (system:init).
//   • Graceful shutdown: all subprocesses closed on SIGTERM/SIGINT.
// ══════════════════════════════════════════════════════════════

interface WarmSession {
  query: Query;
  agentId: string;
  createdAt: number;
  lastUsedAt: number;
  /** When the most recent SDK event arrived. Used for liveness tracking. */
  lastEventAt: number;
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
  pendingFiles: Set<string>;
  resolve: () => void;
  reject: (err: Error) => void;
}

// Key: agentId (one subprocess per agent, shared across all channels)
const warmSessions = new Map<string, WarmSession>();
const activeHandlers = new Map<string, ActiveHandler>();

// TTL: close idle sessions after 10 minutes
const WARM_SESSION_TTL = 10 * 60 * 1000;

// Periodic cleanup of idle / dead sessions
setInterval(() => {
  const now = Date.now();
  for (const [key, session] of warmSessions) {
    const isTimedOut = now - session.lastUsedAt > WARM_SESSION_TTL;
    if (isTimedOut || !session.alive) {
      logger.info(
        { key, reason: !session.alive ? 'dead' : 'ttl' },
        'Closing idle warm session',
      );
      try {
        session.query.close();
      } catch {}
      warmSessions.delete(key);
      activeHandlers.delete(key);
    }
  }
}, 60_000);

/** Close all warm sessions — called on process shutdown. */
function closeAllWarmSessions(): void {
  for (const [key, session] of warmSessions) {
    logger.info({ key }, 'Closing warm session on shutdown');
    try {
      session.query.close();
    } catch {}
  }
  warmSessions.clear();
  activeHandlers.clear();
}

process.on('SIGTERM', closeAllWarmSessions);
process.on('SIGINT', closeAllWarmSessions);

// Key is agentId only (no TiClaw session suffix)
function buildSessionKey(agentId: string): string {
  return agentId;
}

// ── Per-agent Claude SDK session persistence ──────────────────
// The Claude Code subprocess has its own session ID (distinct from
// TiClaw's session ID). We save it after the first run so that cold
// restarts can `resume` that session and recover full conversation history.

function getClaudeSessionPath(agentId: string): string {
  const { base } = agentPaths(agentId);
  return path.join(base, '.claude_session_id');
}

function loadClaudeSessionId(agentId: string): string | null {
  try {
    const p = getClaudeSessionPath(agentId);
    if (fs.existsSync(p)) return fs.readFileSync(p, 'utf-8').trim() || null;
  } catch {}
  return null;
}

function saveClaudeSessionId(agentId: string, claudeSessionId: string): void {
  try {
    const p = getClaudeSessionPath(agentId);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, claudeSessionId, 'utf-8');
  } catch (err: any) {
    logger.warn({ err: err.message }, 'Failed to save Claude session ID');
  }
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
    mcpServers: {
      scheduler: {
        command: 'node',
        args: [path.join(process.cwd(), 'dist/bin/mcp-scheduler.js')],
      },
      os: {
        command: 'node',
        args: [path.join(process.cwd(), 'dist/bin/mcp-os.js')],
      },
    },
    permissionMode: 'acceptEdits' as const,
    model: DEFAULT_LLM_MODEL,
    settingSources: [] as any[],
    includePartialMessages: true,
    pathToClaudeCodeExecutable: cliPath,
    persistSession: true,
    env: {
      ...process.env,
      PWD: workspace,
      ANTHROPIC_API_KEY: effectiveApiKey,
      ...(effectiveBaseUrl ? { ANTHROPIC_BASE_URL: effectiveBaseUrl } : {}),
      TICLAW_AGENT_ID: agentId,
      TICLAW_SESSION_ID: sessionId,
      TICLAW_TASK_ID: taskId,
      PATH: `${path.join(TICLAW_HOME, 'bin')}:${process.env.PATH}`,
    } as Record<string, string>,
  };
}

/**
 * Start the background output loop for a warm session.
 * Reads from the query's async iterable and dispatches to the active handler.
 *
 * IMPORTANT: The handler must already be registered in `activeHandlers` before
 * this is called to avoid dropping early events.
 */
function startOutputLoop(key: string, warm: WarmSession): void {
  let sessionIdSaved = false;

  (async () => {
    try {
      for await (const msg of warm.query) {
        warm.lastEventAt = Date.now();

        const event = msg as any;

        // Capture the Claude SDK's own session_id as early as possible.
        // The system:init event is the first message and reliably carries it.
        if (!sessionIdSaved && event.session_id) {
          sessionIdSaved = true;
          saveClaudeSessionId(warm.agentId, event.session_id);
          logger.debug(
            { agentId: warm.agentId, claudeSessionId: event.session_id },
            'Saved Claude session ID',
          );
        }

        const handler = activeHandlers.get(key);
        if (!handler) {
          // This should not happen (handler is registered before loop starts)
          // but guard anyway to avoid silent drops.
          logger.warn({ key, eventType: event.type }, 'No handler for event — dropped');
          continue;
        }

        await handler.onEvent(event, Date.now() - handler.startTime);

        if (event.type === 'assistant') {
          const blocks = event.message?.content || [];
          for (const block of blocks) {
            if (block.type === 'text' && block.text) {
              handler.textParts.push(block.text);
            }
            // Track files created by Bash tool executions
            if (block.type === 'tool_use' && block.name === 'Bash') {
              const cmd = block.input?.command || block.input?.cmd || '';
              // Extract file arguments from screenshot and other tool commands
              const pathMatch = cmd.match(/--(?:path|out|screenshot)\s+["']?([^"'\s]+)/i);
              if (pathMatch) {
                handler.pendingFiles.add(pathMatch[1]);
              }
              // Detect redirect outputs (> file.png)
              const redirectMatch = cmd.match(/>\s*["']?([^"'\s]+\.(?:png|jpg|jpeg|gif|webp|svg|pdf))/i);
              if (redirectMatch) {
                handler.pendingFiles.add(redirectMatch[1]);
              }
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
  onFile?: (filePath: string, caption?: string) => void | Promise<void>;
}

/**
 * AgentRunner: The refined functional "Body" of a TiClaw Agent.
 *
 * Warm-session pool behaviour:
 *   - Key is agentId only → one subprocess per agent, reused across all
 *     channels (CLI, web, Feishu, etc.)
 *   - First call: cold start, subprocess spawned with the latest prompt
 *   - Subsequent calls within the same process: warm path via streamInput()
 *   - After process restart: cold start with `resume: <savedClaudeSessionId>`
 *     to restore full conversation context from the server
 *   - If streamInput() fails: falls back to cold resume automatically
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
  async run(
    messages: Array<{ role: string; content: string }>,
    taskId?: string,
  ): Promise<void> {
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

    // Key is agentId only — one subprocess shared across all channels
    const key = buildSessionKey(this.state.agent_id);

    // Latest user message — used for both warm streamInput and cold prompt
    const lastUser = messages.filter((m) => m.role === 'user').pop();
    if (!lastUser) {
      logger.warn({ key }, 'Run called with no user messages — skipping');
      this.state.status = 'idle';
      return;
    }

    try {
      const systemPrompt = this.preparePrompt(paths.base, paths.workspace);
      const warm = warmSessions.get(key);
      const isWarm = warm?.alive === true;

      // ── Register result handler BEFORE sending message or starting loop ──
      // This eliminates the handler gap: no events can arrive before the
      // handler is registered.
      const resultPromise = new Promise<void>((resolve, reject) => {
        const handler: ActiveHandler = {
          startTime: Date.now(),
          textParts: [],
          pendingFiles: new Set(),
          resolve,
          reject,
          onEvent: async (event: any, elapsed: number) => {
            await this.handleExecutorEvent(event, elapsed);
          },
          onResult: (event: any) => {
            let finalText =
              event.result?.trim() ||
              handler.textParts.join('\n').trim() ||
              '(done)';

            // Rewrite workspace file paths to ticlaw:// protocol URLs
            const workspace = agentPaths(this.state.agent_id).workspace;
            const agentId = this.state.agent_id;

            // Match absolute paths within the workspace
            const wsEscaped = workspace.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const wsPathRegex = new RegExp(`${wsEscaped}/([^\\s)"\`]+)`, 'g');

            finalText = finalText.replace(wsPathRegex, (_match, relPath) => {
              const absPath = path.join(workspace, relPath);
              if (fs.existsSync(absPath)) {
                return `ticlaw://workspace/${agentId}/${relPath}`;
              }
              return _match;
            });

            // Deliver files detected from tool_use commands (e.g., screenshots)
            if (this.events.onFile && handler.pendingFiles.size > 0) {
              for (const rawPath of handler.pendingFiles) {
                const absPath = path.isAbsolute(rawPath)
                  ? rawPath
                  : path.join(workspace, rawPath);
                if (fs.existsSync(absPath)) {
                  this.events.onFile(absPath, path.basename(absPath));
                }
              }
            }

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

      let usedWarm = false;

      if (isWarm) {
        // ── Warm path: reuse existing subprocess via streamInput() ──
        logger.info({ key }, 'AgentRunner: Warm path — reusing subprocess');
        warm!.lastUsedAt = Date.now();

        try {
          const userMsg: SDKUserMessage = {
            type: 'user',
            message: { role: 'user', content: lastUser.content },
            parent_tool_use_id: null,
            session_id: undefined as any,
            uuid: randomUUID() as UUID,
          };
          await warm!.query.streamInput(
            (async function* () {
              yield userMsg;
            })(),
          );
          usedWarm = true;
        } catch (err: any) {
          // Warm subprocess died. The handler stays registered — the new
          // subprocess's output loop will route events to it so resultPromise
          // still resolves correctly.
          logger.warn(
            { key, err: err.message },
            'AgentRunner: Warm streamInput failed — falling back to cold resume',
          );
          warm!.alive = false;
          warmSessions.delete(key);
          // DO NOT delete the handler here — keep it for the cold path below
        }
      }

      if (!usedWarm) {
        // ── Cold path: spawn new subprocess, resuming server-side session ──
        // Also reached when the warm path failed above (graceful fallback).
        // The handler from the resultPromise above is still registered — the
        // new subprocess's output loop will route events to it correctly.
        logger.info({ key }, 'AgentRunner: Cold start — spawning subprocess');

        // Clean up any stale warm entry (e.g. from the warm failure just above)
        const stale = warmSessions.get(key);
        if (stale && stale !== warm) {
          try {
            stale.query.close();
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

        // Resume the previous Claude-side session if one exists.
        // On the very first cold start, null → fresh session (ID will be saved).
        const savedClaudeSessionId = loadClaudeSessionId(this.state.agent_id);
        if (savedClaudeSessionId) {
          logger.info(
            {
              agentId: this.state.agent_id,
              claudeSessionId: savedClaudeSessionId,
            },
            'AgentRunner: Resuming prior Claude session',
          );
        }

        const agentQuery = query({
          prompt: lastUser.content,
          options: {
            ...opts,
            ...(savedClaudeSessionId ? { resume: savedClaudeSessionId } : {}),
          },
        });

        const newWarm: WarmSession = {
          query: agentQuery as Query,
          agentId: this.state.agent_id,
          createdAt: Date.now(),
          lastUsedAt: Date.now(),
          lastEventAt: Date.now(),
          alive: true,
        };
        warmSessions.set(key, newWarm);

        // Handler is already registered — start the output loop
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
  private preparePrompt(baseDir: string, workspaceDir: string): string {
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
      `You are ${ASSISTANT_NAME}. Work strictly within your assigned workspace: ${workspaceDir}`,
      `Do not create, modify, or interact with files outside of this workspace directory unless specifically requested by the user.`,
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

    try {
      const registry = new SkillsRegistry(SKILLS_CONFIG);
      const available = registry.listAvailable();
      const enabled = available.filter((a) => a.installed?.enabled);

      if (enabled.length > 0) {
        let skillsInfo =
          '## Installed Skills\n\nYou have the following skills enabled and available to use via your Bash tool:\n\n';
        for (const { skill, installed } of enabled) {
          skillsInfo += `### ${skill.name} (v${skill.version})\n`;
          skillsInfo += `${skill.description}\n\n`;
          if (installed?.entrypoint) {
            skillsInfo += `**Entrypoint:** \`${installed.entrypoint}\`\n\n`;
          }
        }
        parts.push(skillsInfo.trim());
      }
    } catch (err: any) {
      logger.error(
        { err: err.message },
        'Failed to load skills for system prompt',
      );
    }

    const prompt = parts.join('\n\n---\n\n');
    
    // Inject ticlaw multimedia protocol instructions
    const multimediaPrompt = `
---
## Multimedia & TICLAW Protocol
When you capture screenshots, generate images, or discover files that should be SHOWN to the user, you MUST include a specific URI in your text reply.
- To show an image: \`ticlaw://image/<absolute_path_or_filename>\`
- To share a file: \`ticlaw://file/<absolute_path_or_filename>\`
The platform will automatically extract these links and render the content visually. Do not just describe the items; link them using this protocol.
---
`;
    const finalPrompt = prompt + multimediaPrompt;
    _promptCache.set(this.state.agent_id, { prompt: finalPrompt, mtimeKey });
    return finalPrompt;
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
