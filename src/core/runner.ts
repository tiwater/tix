import fs from 'fs';
import path from 'path';
import { query } from '@anthropic-ai/claude-agent-sdk';
import type { Query, SDKResultMessage } from '@anthropic-ai/claude-agent-sdk';
import { logger } from './logger.js';
import {
  AGENT_MIND_FILES,
  ASSISTANT_NAME,
  DEFAULT_LLM_MODEL,
  ANTHROPIC_API_KEY,
  SKILLS_CONFIG,
  agentPaths,
  TICLAW_HOME,
} from './config.js';
import { getSession } from './db.js';
import { createRequire } from 'module';
import { SkillsRegistry } from '../skills/registry.js';
import type {
  SessionContext,
  RunnerState,
  RunnerStatus,
  RunnerActivity,
} from './types.js';

const require = createRequire(import.meta.url);

/**
 * Find the built-in Claude Agent SDK CLI executable.
 */
function getClaudeCliPath(): string {
  // SDK requires a path ending with .js/.mjs/.ts/.tsx to use node mode
  // Use the flat node_modules path after npm install
  const cliPath = path.join(
    process.cwd(),
    'node_modules/@anthropic-ai/claude-agent-sdk/cli.js',
  );
  console.log('[DEBUG getClaudeCliPath] cwd:', process.cwd());
  console.log('[DEBUG getClaudeCliPath] cliPath:', cliPath);
  console.log('[DEBUG getClaudeCliPath] exists:', fs.existsSync(cliPath));
  try {
    fs.accessSync(cliPath, fs.constants.X_OK);
    console.log('[DEBUG getClaudeCliPath] X_OK check passed');
  } catch (e: any) {
    console.log('[DEBUG getClaudeCliPath] X_OK check failed:', e.message);
  }
  if (fs.existsSync(cliPath)) return cliPath;
  return '';
}

export interface RunnerEvents {
  onStateChange?: (state: RunnerState) => void | Promise<void>;
  onReply?: (text: string) => void | Promise<void>;
}

/**
 * AgentRunner: The refined functional "Body" of a TiClaw Agent.
 * Coalesces persona management (Brain) and task execution (Hands).
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
    this.initBrain(paths.base);

    logger.info(
      { agent_id: this.state.agent_id, task_id: this.state.task_id },
      'AgentRunner: Starting task loop',
    );
    await this.notifyState();

    try {
      const systemPrompt = this.preparePrompt(paths.base);
      const start = Date.now();
      const textParts: string[] = [];

      const cliPath = getClaudeCliPath();

      const agentQuery = query({
        prompt: message,
        options: {
          systemPrompt,
          cwd: paths.workspace,
          allowedTools: ['Read', 'Edit', 'Bash', 'Glob', 'Grep', 'Write'],
          permissionMode: 'acceptEdits',
          model: DEFAULT_LLM_MODEL,
          includePartialMessages: true,
          pathToClaudeCodeExecutable: cliPath, // Fix: Explicitly set the path
          env: {
            ...process.env,
            ANTHROPIC_API_KEY: ANTHROPIC_API_KEY || '',
            TICLAW_AGENT_ID: this.state.agent_id,
            TICLAW_SESSION_ID: this.state.session_id,
            TICLAW_TASK_ID: this.state.task_id!,
          } as Record<string, string>,
        },
      });

      // Handle AbortSignal
      const abortQuery = () => {
        try {
          (agentQuery as Query).close();
        } catch {}
      };
      this.controller.signal.addEventListener('abort', abortQuery, {
        once: true,
      });

      for await (const msg of agentQuery) {
        if (this.controller.signal.aborted) break;

        const event = msg as any;
        await this.handleExecutorEvent(event, Date.now() - start);

        if (event.type === 'assistant') {
          const blocks = event.message?.content || [];
          for (const block of blocks) {
            if (block.type === 'text' && block.text) {
              textParts.push(block.text);
            }
          }
        }

        if (event.type === 'result') {
          const finalText =
            event.result?.trim() || textParts.join('\n').trim() || '(done)';
          await this.events.onReply?.(finalText);
          // Consolidate memory after successful completion
          await this.consolidateMemory(paths.base, finalText);
        }
      }

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
  private initBrain(baseDir: string): void {
    if (!fs.existsSync(baseDir)) fs.mkdirSync(baseDir, { recursive: true });

    // Ensure memory journal directory exists
    const memoryDir = path.join(baseDir, 'memory');
    if (!fs.existsSync(memoryDir)) fs.mkdirSync(memoryDir, { recursive: true });

    // Bootstrap basic mind files if missing
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
   * Builds the system prompt by aggregating all "Brain" Markdown files.
   * Implements chronological memory by reading recent journal fragments.
   */
  private preparePrompt(baseDir: string): string {
    const parts: string[] = [
      `You are ${ASSISTANT_NAME}. Work strictly within your assigned workspace.`,
      `Your core persona and memory are defined in the following Markdown files.`,
    ];

    // 1. Core Mind Files (SOUL, IDENTITY, etc.)
    for (const filename of AGENT_MIND_FILES) {
      const p = path.join(baseDir, filename);
      if (fs.existsSync(p)) {
        const content = fs.readFileSync(p, 'utf-8').trim();
        if (content) parts.push(`### ${filename}\n${content}`);
      }
    }

    // 2. Chronological Memory Fragments (Recent Journal)
    const memoryDir = path.join(baseDir, 'memory');
    if (fs.existsSync(memoryDir)) {
      const journals = fs
        .readdirSync(memoryDir)
        .filter((f) => f.endsWith('.md'))
        .sort()
        .reverse()
        .slice(0, 3); // Load last 3 days

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

    return parts.join('\n\n---\n\n');
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

    // JSON Stream Logging
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
