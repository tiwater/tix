import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

import {
  TC_CODING_CLI,
  ASSISTANT_NAME,
  TICLAW_HOME,
  IDLE_TIMEOUT,
  POLL_INTERVAL,
  TRIGGER_PATTERN,
  NODE_HOSTNAME,
  SKILLS_CONFIG,
  MIND_ADMIN_USERS,
} from './core/config.js';
import './channels/index.js';
import { SkillsRegistry } from './skills/registry.js';
import {
  getChannelFactory,
  getRegisteredChannelNames,
} from './channels/registry.js';
import {
  ensureSession,
  getAllChats,
  getAllRegisteredProjects,
  getAllSessions,
  getAllSchedules,
  getMessagesSince,
  getNewMessages,
  getRouterState,
  getSession,
  initStore,
  setRegisteredProject,
  setRouterState,
  storeChatMetadata,
  storeMessage,
  getRecentMessages,
} from './core/store.js';

import { logger } from './core/logger.js';
import { executeSkillsCommand } from './skills/commands.js';
import {
  readEnrollmentState,
  verifyEnrollmentToken,
} from './core/enrollment.js';
import { generateSecureId } from './core/utils.js';
import {
  routeOutbound,
  routeOutboundFile,
  routeSetTyping,
  routeSendReturningId,
  routeEditMessage,
} from './router.js';
import { startSchedulerLoop } from './task-scheduler.js';
import {
  AvailableProject,
  Channel,
  NewMessage,
  RegisteredProject,
} from './core/types.js';

import { runAgent } from './run-agent.js';
import { broadcastToChat } from './channels/http.js';
import { getEnabledChannelsFromConfig, readEnvFile } from './core/env.js';
import {
  isSupabaseConfigured,
  pullFromSupabase,
  scheduleSupabasePush,
  startPeriodicSupabasePush,
} from './sync/supabase-sync.js';

// Define ChannelOpts locally as it was removed from registry.ts
export interface ChannelOpts {
  onMessage: (chatJid: string, msg: NewMessage) => void;
  onChatMetadata: (
    chatJid: string,
    timestamp: string,
    name?: string,
    channel?: string,
    isGroup?: boolean,
  ) => void;
  registeredProjects: () => Record<string, RegisteredProject>;
  onGroupRegistered: (jid: string, group: RegisteredProject) => void;
}

// Global state
let registeredProjects: Record<string, RegisteredProject> = {};
const sessions: Record<string, string> = {}; // folder -> sessionId
const lastAgentTimestamp: Record<string, string> = {}; // chatJid -> iso
const channels: Channel[] = [];

function isAdminActor(actor?: string): boolean {
  if (!actor) return false;
  return MIND_ADMIN_USERS.includes(actor);
}

/** Check if a registered JID still points to a live channel. */
async function isChannelAlive(jid: string): Promise<boolean> {
  for (const ch of channels) {
    if (ch.ownsJid(jid) && ch.channelExists) {
      return ch.channelExists(jid);
    }
  }
  return false;
}

let messageLoopRunning = false;

// Simple mutex per channel to prevent overlapping agent runs
const activeAgentLocks = new Map<string, Promise<any>>();

async function processMessages(chatJid: string): Promise<boolean> {
  let group = registeredProjects[chatJid];
  if (!group) return false;

  const sinceTimestamp = lastAgentTimestamp[chatJid] || '';
  const messages = getMessagesSince(chatJid, sinceTimestamp, ASSISTANT_NAME);

  if (messages.length === 0) return true;

  // Update last timestamp BEFORE running to avoid loops on failure
  const newest = messages[messages.length - 1].timestamp;
  lastAgentTimestamp[chatJid] = newest;
  setRouterState(chatJid, newest);

  // Extract raw text from messages for agent thinking
  const rawText = messages.map((m) => m.content).join('\n');
  const latestMsg = messages[messages.length - 1];

  const recentMessages = getRecentMessages(chatJid, 10);
  let contextText = rawText;
  if (recentMessages.length > messages.length) {
    const historyMsgs = recentMessages.slice(
      0,
      recentMessages.length - messages.length,
    );
    const historyText = historyMsgs
      .map((m) => `${m.sender_name || 'User'}: ${m.content}`)
      .join('\n');
    contextText = `[Conversation History]\n${historyText}\n\n[Latest Message]\n${rawText}`;
  }

  logger.info(
    { chatJid, messageCount: messages.length, rawText: rawText.slice(0, 200) },
    'processMessages: starting',
  );

  try {
    // Show typing indicator while we process
    routeSetTyping(channels, chatJid, true);

    // Enrollment control plane: /enroll status | /enroll verify <token>
    const latestText = messages[messages.length - 1]?.content?.trim() || '';
    if (latestText.startsWith('/enroll')) {
      const parts = latestText.split(/\s+/);
      const sub = parts[1] || 'status';
      if (sub === 'status') {
        const e = readEnrollmentState(NODE_HOSTNAME || undefined);
        await sendFn(
          chatJid,
          `🔐 Enrollment status\n- node: ${e.node_id}\n- fingerprint: ${e.node_fingerprint}\n- trust_state: ${e.trust_state}\n- token_expires_at: ${e.token_expires_at || 'none'}\n- failed_attempts: ${e.failed_attempts}${e.frozen_until ? `\n- frozen_until: ${e.frozen_until}` : ''}`,
        );
        return true;
      }

      if (sub === 'verify') {
        const token = parts[2];
        if (!token) {
          await sendFn(chatJid, 'Usage: /enroll verify <token>');
          return true;
        }
        const e = readEnrollmentState(NODE_HOSTNAME || undefined);
        const result = verifyEnrollmentToken({
          token,
          nodeFingerprint: e.node_fingerprint,
          nodeId: NODE_HOSTNAME || undefined,
        });

        if (result.ok) {
          await sendFn(
            chatJid,
            `✅ Enrollment verified. trust_state=${result.state.trust_state}`,
          );
        } else {
          await sendFn(
            chatJid,
            `❌ Enrollment verification failed: ${result.code} (state=${result.state.trust_state})`,
          );
        }
        return true;
      }
    }

    if (latestText.startsWith('/skills')) {
      const rawArgs = latestText.replace(/^\/skills\b/, '').trim();
      const actor = latestMsg?.sender || chatJid;
      const result = executeSkillsCommand(rawArgs, {
        actor,
        isAdmin: isAdminActor(actor),
      });
      await sendFn(chatJid, result.message);
      return result.ok;
    }

    // Check if we have a valid workspace for this group
    const workspace = getFactoryPath(group);
    const hasWorkspace = fs.existsSync(workspace);
    logger.info(
      { chatJid, workspace, hasWorkspace },
      'processMessages: workspace check',
    );

    const aiMessages = recentMessages.map((m) => ({
      role: (m.sender_name === ASSISTANT_NAME ? 'assistant' : 'user') as
        | 'assistant'
        | 'user',
      content: m.content,
    }));

    try {
      if (!registeredProjects[chatJid] && !hasWorkspace) {
        logger.info(
          { chatJid },
          'Creating temporary context for unregistered chat',
        );
        group = {
          name: 'unknown',
          folder: 'unknown',
          trigger: `@${ASSISTANT_NAME}`,
          added_at: new Date().toISOString(),
          requiresTrigger: true,
          isMain: false,
        };
      }

      // Resolve or create a session for this chat
      const agentId = (group as any).agent_id || group.folder;
      const sessionId = chatJid;
      const channel = chatJid.startsWith('dc:')
        ? 'discord'
        : chatJid.startsWith('web:')
          ? 'http'
          : chatJid.startsWith('fs:')
            ? 'feishu'
            : 'unknown';
      const session = ensureSession({
        agent_id: agentId,
        session_id: sessionId,
        channel,
        agent_name: group.name,
      });

      let streamedToWeb = false;
      let statusMessageId: string | null = null;
      let lastProgressSentAt = 0;
      let lastProgressKey = '';

      const progressTextFromEvent = (
        event: Record<string, unknown>,
      ): string | null => {
        const phase = typeof event.phase === 'string' ? event.phase : '';
        const action = typeof event.action === 'string' ? event.action : '';
        const target = typeof event.target === 'string' ? event.target : '';
        const elapsed =
          typeof event.elapsed_ms === 'number' ? event.elapsed_ms : 0;
        const secs = Math.max(1, Math.round(elapsed / 1000));

        if (phase === 'stream_event' && action === 'speaking') return null;

        if (action.startsWith('executing_')) {
          const tool = action.replace(/^executing_/, '');
          return `🛠 正在调用 ${tool}...（${secs}s）`;
        }

        if (phase === 'assistant' || action === 'thinking') {
          return `🧠 正在思考与规划下一步...（${secs}s）`;
        }

        if (phase === 'result') {
          return `📦 正在整理最终结果...（${secs}s）`;
        }

        if (phase === 'error') {
          return `⚠️ 执行中遇到错误，正在收敛处理...（${secs}s）`;
        }

        return `⏳ 正在处理中...（${secs}s）`;
      };

      const emitProgress = async (text: string) => {
        if (!text || !text.trim()) return;

        if (chatJid.startsWith('web:')) {
          broadcastToChat(chatJid, {
            type: 'progress',
            text,
          });
          return;
        }

        const channel = channels.find(
          (c) => c.ownsJid(chatJid) && c.isConnected(),
        );
        if (statusMessageId && channel?.editMessage) {
          try {
            await routeEditMessage(channels, chatJid, statusMessageId, text);
            return;
          } catch (err) {
            logger.debug(
              { err, chatJid },
              'Progress edit failed, fallback to new message',
            );
            statusMessageId = null;
          }
        }

        if (!statusMessageId) {
          statusMessageId = await routeSendReturningId(channels, chatJid, text);
          if (!statusMessageId) {
            await sendFn(chatJid, text);
          }
        }
      };

      await runAgent({
        group,
        session: { ...session, task_id: `run-${Date.now()}` },
        messages: aiMessages,
        onEvent: async (event) => {
          // Forward streaming text deltas to SSE clients
          // Runner emits: phase='stream_event', action='speaking', target=deltaText
          if (
            (event as any).phase === 'stream_event' &&
            (event as any).action === 'speaking' &&
            (event as any).target
          ) {
            streamedToWeb = true;
            broadcastToChat(chatJid, {
              type: 'stream_delta',
              text: (event as any).target,
            });
          }

          const progressText = progressTextFromEvent(
            event as Record<string, unknown>,
          );
          if (!progressText) return;

          const now = Date.now();
          const progressKey = `${(event as any).phase || ''}|${(event as any).action || ''}`;
          const shouldSend =
            !lastProgressSentAt ||
            progressKey !== lastProgressKey ||
            now - lastProgressSentAt >= 10000;

          if (!shouldSend) return;

          lastProgressSentAt = now;
          lastProgressKey = progressKey;
          await emitProgress(progressText);
        },
        onReply: async (text) => {
          if (chatJid.startsWith('web:')) {
            broadcastToChat(chatJid, {
              type: 'progress_end',
            });
          }

          if (chatJid.startsWith('web:') && streamedToWeb) {
            // Web clients already received the response via stream_delta events.
            // Send stream_end so the client knows streaming is complete,
            // and store the bot message without re-broadcasting the full text.
            broadcastToChat(chatJid, {
              type: 'stream_end',
              text,
            });
            // Still store the bot message for history
            const ts = new Date().toISOString();
            lastAgentTimestamp[chatJid] = ts;
            setRouterState(chatJid, ts);
            storeMessage({
              id: generateSecureId('bot'),
              chat_jid: chatJid,
              sender: ASSISTANT_NAME,
              sender_name: ASSISTANT_NAME,
              content: text,
              timestamp: ts,
              is_from_me: true,
            });
          } else {
            // Non-web channels (Discord, Feishu, etc.) or no streaming happened
            await sendFn(chatJid, text);
          }
        },
      });
      return true;
    } catch (err: any) {
      logger.error({ err }, 'Agent failed');
      await sendFn(
        chatJid,
        `❌ **Agent Error**\n\`\`\`\n${err.message}\n\`\`\``,
      );
      return false;
    }
  } catch (err: any) {
    logger.error({ err, chatJid }, 'processMessages: unexpected error');
    return false;
  } finally {
    routeSetTyping(channels, chatJid, false);
  }
}

/** Resolve the workspace directory for a group. */
function getFactoryPath(group: RegisteredProject): string {
  return path.join(TICLAW_HOME, 'factory', group.folder);
}

export function getAvailableProjects(): AvailableProject[] {
  const allChats = getAllChats();
  return allChats.map((chat) => ({
    jid: chat.jid,
    name: chat.name || chat.jid,
    lastActivity: chat.last_message_time,
    isRegistered: !!registeredProjects[chat.jid],
  }));
}

/** @internal - for tests only. */
export function _setRegisteredProjects(
  groups: Record<string, RegisteredProject>,
): void {
  registeredProjects = groups;
}

function registerProject(jid: string, group: RegisteredProject): void {
  // Ensure a chats row exists for this JID before registering,
  // so that subsequent message storage doesn't fail with FK constraint.
  storeChatMetadata(jid, new Date().toISOString(), group.name);
  setRegisteredProject(jid, group);
  registeredProjects[jid] = group;
  scheduleSupabasePush();
  logger.info({ jid, folder: group.folder }, 'Group registered');
}

async function startMessageLoop(): Promise<void> {
  if (messageLoopRunning) {
    logger.debug('Message loop already running, skipping duplicate start');
    return;
  }
  messageLoopRunning = true;
  logger.debug('Starting message loop');

  // Track what the message loop has already SEEN (to avoid re-enqueuing).
  // This is separate from lastAgentTimestamp which tracks what processMessages
  // has actually PROCESSED.
  const lastLoopTimestamp: Record<string, string> = {};

  while (messageLoopRunning) {
    try {
      const jids = Object.keys(registeredProjects);
      const lastGlobalTs =
        Object.values(lastLoopTimestamp).sort().reverse()[0] ||
        Object.values(lastAgentTimestamp).sort().reverse()[0] ||
        '';

      const { messages } = getNewMessages(jids, lastGlobalTs, ASSISTANT_NAME);

      for (const msg of messages) {
        const chatJid = msg.chat_jid;
        const group = registeredProjects[chatJid];

        if (!group) {
          logger.debug({ chatJid }, 'Skipping message from unregistered group');
          continue;
        }

        // Track that the loop has seen this message (prevents re-enqueue)
        if (
          !lastLoopTimestamp[chatJid] ||
          msg.timestamp > lastLoopTimestamp[chatJid]
        ) {
          lastLoopTimestamp[chatJid] = msg.timestamp;
        }

        if (msg.is_from_me) continue;

        const triggerMatch = TRIGGER_PATTERN.test(msg.content);
        if (group.isMain || !group.requiresTrigger || triggerMatch) {
          logger.info(
            { chatJid, sender: msg.sender_name },
            'Trigger matched, checking locks',
          );

          if (!activeAgentLocks.has(chatJid)) {
            const agentPromise = processMessages(chatJid).finally(() => {
              activeAgentLocks.delete(chatJid);
            });
            activeAgentLocks.set(chatJid, agentPromise);
          } else {
            logger.debug(
              { chatJid },
              'Agent already running for this channel, skipping enqueue',
            );
          }
        }
      }
    } catch (err) {
      logger.error({ err }, 'Error in message loop');
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL));
  }
}

function loadState(): void {
  const groups = getAllRegisteredProjects();
  for (const [jid, group] of Object.entries(groups)) {
    registeredProjects[jid] = group;
  }
  logger.info(
    { count: Object.keys(registeredProjects).length },
    'Groups loaded',
  );

  const dbSessions = getAllSessions();
  for (const sess of dbSessions) {
    sessions[sess.agent_id] = sess.session_id;
  }
  logger.info({ count: Object.keys(sessions).length }, 'Sessions loaded');

  for (const jid of Object.keys(registeredProjects)) {
    const timestamp = getRouterState(jid);
    if (timestamp) {
      lastAgentTimestamp[jid] = timestamp;
    }
  }
}

function handleChatMetadata(
  chatJid: string,
  timestamp: string,
  name?: string,
  channel?: string,
  isGroup?: boolean,
): void {
  storeChatMetadata(chatJid, timestamp, name, channel, isGroup);
}

function recoverPendingMessages(): void {
  for (const [chatJid, group] of Object.entries(registeredProjects)) {
    const sinceTimestamp = lastAgentTimestamp[chatJid] || '';
    const pending = getMessagesSince(chatJid, sinceTimestamp, ASSISTANT_NAME);
    if (pending.length > 0) {
      logger.info(
        { group: group.name, pendingCount: pending.length },
        'Recovery: replaying unprocessed messages',
      );
      if (!activeAgentLocks.has(chatJid)) {
        const agentPromise = processMessages(chatJid).finally(() => {
          activeAgentLocks.delete(chatJid);
        });
        activeAgentLocks.set(chatJid, agentPromise);
      }
    }
  }
}

let sendFn: (
  jid: string,
  text: string,
  options?: { embeds?: any[] },
) => Promise<void>;
let createChannelFn: (fromJid: string, name: string) => Promise<string | null>;

async function main(): Promise<void> {
  logger.info('TiClaw starting');

  initStore();
  logger.info('Database initialized');

  // Ensure default agent and session exist
  ensureSession({
    agent_id: 'web-agent',
    session_id: 'web-session',
    channel: 'web',
    agent_name: 'Web Agent',
  });
  logger.info('Default agent and session ensured');

  if (isSupabaseConfigured()) {
    await pullFromSupabase();
    startPeriodicSupabasePush();
  }
  loadState();

  const channelOpts: ChannelOpts = {
    onMessage: (chatJid: string, msg: NewMessage) => {
      storeMessage(msg);
      // Event-driven: immediately process web messages instead of waiting for poll
      if (chatJid.startsWith('web:') && !msg.is_from_me) {
        if (!activeAgentLocks.has(chatJid)) {
          const agentPromise = processMessages(chatJid).finally(() => {
            activeAgentLocks.delete(chatJid);
          });
          activeAgentLocks.set(chatJid, agentPromise);
        }
      }
    },
    onChatMetadata: (
      chatJid: string,
      timestamp: string,
      name?: string,
      channel?: string,
      isGroup?: boolean,
    ) => handleChatMetadata(chatJid, timestamp, name, channel, isGroup),
    registeredProjects: () => registeredProjects,
    onGroupRegistered: (jid: string, group: RegisteredProject) =>
      registerProject(jid, group),
  };

  const CHANNEL_CONNECT_TIMEOUT = 15_000;
  const enabledFromConfig = getEnabledChannelsFromConfig();
  const registeredChannelNames = getRegisteredChannelNames();
  // Infrastructure channels (hub-client) must always connect regardless of config
  const INFRA_CHANNELS = ['hub-client'];
  const toConnect =
    enabledFromConfig.length > 0
      ? registeredChannelNames.filter(
          (n) => enabledFromConfig.includes(n) || INFRA_CHANNELS.includes(n),
        )
      : registeredChannelNames;
  for (const name of toConnect) {
    const factory = getChannelFactory(name);
    if (factory) {
      const channel = factory(channelOpts as any);
      if (channel) {
        try {
          logger.info({ channel: name }, 'Connecting channel');
          await Promise.race([
            channel.connect(),
            new Promise<never>((_, reject) =>
              setTimeout(
                () =>
                  reject(
                    new Error(
                      `Channel ${name} connect timed out after ${CHANNEL_CONNECT_TIMEOUT / 1000}s`,
                    ),
                  ),
                CHANNEL_CONNECT_TIMEOUT,
              ),
            ),
          ]);
          channels.push(channel);
        } catch (err) {
          logger.error(
            { channel: name, err },
            'Failed to connect channel — skipping',
          );
        }
      }
    }
  }

  sendFn = async (jid: string, text: string, options?: { embeds?: any[] }) => {
    await routeOutbound(channels, jid, text, options);
    const ts = new Date().toISOString();
    lastAgentTimestamp[jid] = ts;
    setRouterState(jid, ts);
    // Store bot response so conversation history includes assistant turns
    if (text.trim()) {
      storeMessage({
        id: generateSecureId('bot'),
        chat_jid: jid,
        sender: ASSISTANT_NAME,
        sender_name: ASSISTANT_NAME,
        content: text,
        timestamp: ts,
        is_from_me: true,
        is_bot_message: true,
      });
    }
  };

  createChannelFn = async (
    fromJid: string,
    channelName: string,
  ): Promise<string | null> => {
    for (const ch of channels) {
      if (ch.ownsJid(fromJid) && ch.createChannel) {
        return ch.createChannel(fromJid, channelName);
      }
    }
    return null;
  };

  recoverPendingMessages();

  // --- Auto-enable default skills ---
  try {
    const registry = new SkillsRegistry(SKILLS_CONFIG);
    const defaultSkills = SKILLS_CONFIG.defaultEnabled;
    const ctx = { actor: 'system-init', isAdmin: true, approveLevel3: true };
    for (const skillName of defaultSkills) {
      try {
        if (!registry.getInstalled(skillName)) {
          registry.installSkill(skillName, ctx);
        }
        const installed = registry.getInstalled(skillName);
        if (installed && !installed.enabled) {
          registry.enableSkill(skillName, ctx);
          logger.info(`Auto-enabled default skill: ${skillName}`);
        }
      } catch (err: any) {
        logger.warn(`Failed to auto-enable skill ${skillName}: ${err.message}`);
      }
    }
  } catch (err: any) {
    logger.warn(`Failed to initialize default skills: ${err.message}`);
  }

  startMessageLoop();

  startSchedulerLoop({
    registeredProjects: () => registeredProjects,
    sendMessage: sendFn,
  });

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutdown signal received');
    // Wait for all active agents to finish (up to 10s)
    const activePromises = Array.from(activeAgentLocks.values());
    if (activePromises.length > 0) {
      logger.info(
        { draining: activePromises.length },
        'Waiting for active agents to finish...',
      );
      await Promise.race([
        Promise.allSettled(activePromises),
        new Promise((r) => setTimeout(r, 10000)),
      ]);
    }
    await Promise.allSettled(channels.map((ch) => ch.disconnect()));
    messageLoopRunning = false;
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  logger.info(`TiClaw running (trigger: @${ASSISTANT_NAME})`);
}

const isDirectRun =
  process.argv[1] &&
  new URL(import.meta.url).pathname ===
    new URL(`file://${process.argv[1]}`).pathname;

if (isDirectRun) {
  main().catch((err) => {
    logger.error({ err }, 'Failed to start TiClaw');
    process.exit(1);
  });
}
