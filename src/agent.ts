import { generateText, stepCountIs, type ModelMessage } from 'ai';
import type { ContainerOutput } from './core/types.js';
import { buildSessionTools } from './tools/executor.js';
import { buildWorkspaceTool } from './tools/workspace.js';
import { loadGroupMindContext } from './core/mind-files.js';
import { logger } from './core/logger.js';
import { RegisteredProject } from './core/types.js';
import { getModelName, getOpenRouter } from './core/llm.js';

/**
 * Lightweight LLM call to interpret a raw Gemini screen and format for the channel.
 * Used by the async idle callback — no tools, just text in → text out.
 */
async function interpretScreen(
  screenContent: string,
  groupName: string,
): Promise<string> {
  const openrouter = getOpenRouter();
  const model = getModelName();

  const interpretPrompt = `You are formatting output from the workspace coding CLI for a chat channel.

The output is from the "${groupName}" repository (https://github.com/${groupName}).

## Your task

Format the output for the chat. If it's plain text, clean it up. If it contains TUI artifacts (✦ markers, status bars, "Type your message"), extract the meaningful response.
- Include clickable GitHub links for commits, PRs, issues, and files.
- Use markdown: **bold**, \`code\`, > blockquotes, bullet lists.
- Keep it concise and scannable.

## Raw output

${screenContent}`;

  try {
    const result = await generateText({
      model: openrouter(model),
      prompt: interpretPrompt,
    });

    return result.text || '🦀 Task completed but could not extract response.';
  } catch (err) {
    logger.error({ err }, 'Screen interpretation failed');
    return '🦀 Task completed. Check the workspace for details.';
  }
}

/**
 * The main agent loop that orchestrates tasks and uses manual tool abstraction.
 */
export async function runAgentOrchestrator(opts: {
  chatJid: string;
  group: RegisteredProject;
  workspacePath: string;
  isMain: boolean;
  sessionId?: string;
  codingCli?: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  onOutput?: (output: ContainerOutput) => Promise<void> | void;
  onReply?: (text: string) => Promise<void>;
  // For workspace setup tool
  sendFn: (jid: string, text: string) => Promise<void>;
  createChannelFn: (fromJid: string, name: string) => Promise<string | null>;
  registerProjectFn: (jid: string, group: RegisteredProject) => void;
  isChannelAliveFn: (jid: string) => Promise<boolean>;
  registeredProjects: Record<string, RegisteredProject>;
}): Promise<string> {
  const openrouter = getOpenRouter();
  const model = getModelName();

  logger.info({ model, chatJid: opts.chatJid }, 'Starting agent orchestrator');

  // Async callback: when the workspace CLI becomes idle after a prompt,
  // interpret the screen and deliver the formatted result to the channel.
  const onIdleCallback = async (screen: string) => {
    logger.info(
      { chatJid: opts.chatJid, screenLength: screen.length },
      'Idle callback fired, interpreting screen',
    );

    try {
      const formatted = await interpretScreen(screen, opts.group.name);
      logger.info(
        { chatJid: opts.chatJid, responseLength: formatted.length },
        'Interpreted response, sending to channel',
      );
      if (opts.onReply) await opts.onReply(formatted);
    } catch (err) {
      logger.error({ err, chatJid: opts.chatJid }, 'Idle callback failed');
      if (opts.onReply) {
        await opts.onReply(
          '🦀 Task completed. Check the workspace for details.',
        );
      }
    }
  };

  // Progress callback: fires periodically during long tasks.
  // Uses a lightweight LLM call to summarize the current screen into a status update.
  const onProgressCallback = async (screen: string, elapsedMs: number) => {
    const elapsed = Math.round(elapsedMs / 1000);
    logger.info({ chatJid: opts.chatJid, elapsed }, 'Progress update');

    try {
      const result = await generateText({
        model: openrouter(model),
        prompt: `You are summarizing what the workspace coding CLI is currently doing, based on its terminal screen capture.

Return a SINGLE short sentence (max 15 words) describing the current activity. Start with a verb.
Examples: "Reading seed-data.ts to find legacy table references", "Running unit tests", "Editing auth.ts to fix the login bug", "Searching for open issues in the repository"

If unclear, just say "Working on the task".

Raw screen:
${screen}`,
      });

      const summary = result.text?.trim() || 'Working on the task';
      const statusMsg = `⏳ (${elapsed}s) ${summary}`;

      if (opts.onReply) {
        await opts.onReply(statusMsg);
      }
    } catch (err) {
      logger.warn({ err }, 'Progress summarization failed');
    }
  };

  const { captureSessionTool, sendToSessionTool } = buildSessionTools(
    opts.group,
    opts.workspacePath,
    opts.chatJid,
    opts.isMain,
    opts.sessionId,
    opts.codingCli,
    opts.onOutput,
    onIdleCallback,
    onProgressCallback,
  );

  const workspaceTool = buildWorkspaceTool(
    opts.chatJid,
    opts.sendFn,
    opts.createChannelFn,
    opts.registerProjectFn,
    opts.isChannelAliveFn,
    opts.registeredProjects,
  );

  const mindContext = loadGroupMindContext(opts.group.folder);
  const systemPrompt = `You are TiClaw 🦀, a robot mind builder.
You evolve personality and memory through interaction. You handle most tasks directly — conversation, questions, planning, advice. You have optional skills for when you need to run code or access a repository.

## Primary mode: you handle everything

Answer questions, chat, and help directly. You have access to the LLM and can respond to almost anything. Do NOT delegate unless the task genuinely requires code execution, git, or repository access.

## Optional skill: workspace (coding CLI)

When a task needs to run code, access a repo, build, or fix something, you can use the **workspace skill**. It runs a coding CLI (e.g. Gemini, Codex, Claude) in headless mode. Use it only when necessary.

### Workspace tools (use only when needed)

1. \`captureSessionTool\`: Check workspace readiness (returns immediately in headless mode).
2. \`sendToSessionTool\`: Run a natural-language prompt in the workspace CLI. The result is delivered when done. Send ONCE only.
3. \`workspaceTool\`: Clone, update, or delete a repository workspace.

When using the workspace skill: send via \`sendToSessionTool\`. The result is delivered when the CLI completes.

**Communicate with the CLI in natural language** (e.g. "What was the last commit?", "Fix the bug in auth.ts"), never raw shell commands.

## Rules

1. Answer directly whenever you can. Use the workspace skill only when the task requires code, git, or repo access.
2. Never send raw shell commands to the workspace CLI. Always natural language.
3. Never re-send a prompt.
4. Never ask "would you like me to proceed?" — just do it.${mindContext}`;

  try {
    const result = await generateText({
      model: openrouter(model),
      system: systemPrompt,
      messages: opts.messages as ModelMessage[],
      tools: {
        workspaceTool,
        captureSessionTool,
        sendToSessionTool,
      },
      stopWhen: stepCountIs(250),
      onStepFinish({ toolCalls }) {
        if (toolCalls.length > 0) {
          const names = toolCalls.map((t) => t.toolName).join(', ');
          logger.info(
            { chatJid: opts.chatJid, tools: names },
            'Tool dispatched',
          );
        }
      },
    });

    logger.info(
      {
        chatJid: opts.chatJid,
        text: result.text?.slice(0, 200),
        steps: result.steps.length,
        toolCalls: result.steps.flatMap((s) =>
          s.toolCalls.map((t) => t.toolName),
        ),
      },
      'Agent result',
    );

    if (result.text && result.text.trim()) {
      if (opts.onReply) await opts.onReply(result.text);
      return result.text;
    }

    // Fallback: tools ran successfully but no final text
    const fallbackMsg = '🦀 Task sent to workspace.';
    if (opts.onReply) await opts.onReply(fallbackMsg);
    return fallbackMsg;
  } catch (err: any) {
    logger.error({ err }, 'Agent generation failed');
    const fallback = `I encountered an error while thinking: ${err.message}`;
    if (opts.onReply) await opts.onReply(fallback);
    return fallback;
  }
}
