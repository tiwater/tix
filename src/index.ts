import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

import {
  TC_CODING_CLI,
  ASSISTANT_NAME,
  DEFAULT_RUNTIME_ID,
  TICLAW_HOME,
  IDLE_TIMEOUT,
  MIND_ADMIN_USERS,
  POLL_INTERVAL,
  TRIGGER_PATTERN,
  CONTROL_PLANE_RUNTIME_ID,
} from './core/config.js';
import './channels/index.js';
import {
  getChannelFactory,
  getRegisteredChannelNames,
} from './channels/registry.js';
import {
  getAllChats,
  getAllRegisteredProjects,
  getAllSessions,
  ensureSession,
  getMessagesSince,
  getNewMessages,
  getSessionByChatJid,
  getRouterState,
  initDatabase,
  setRegisteredProject,
  setRouterState,
  storeChatMetadata,
  storeMessage,
  getRecentMessages,
} from './core/db.js';
import {
  createPackage,
  diffMindVersions,
  listPackages,
  lockMind,
  mindStatus,
  recordUserInteraction,
  rollbackPackage,
  setMindPersonaPatch,
  unlockMind,
} from './core/mind.js';
import { logger } from './core/logger.js';
import {
  readEnrollmentState,
  verifyEnrollmentToken,
} from './core/enrollment.js';
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
const lastAgentTimestamp: Record<string, string> = {}; // chatJid -> iso
const channels: Channel[] = [];

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

function normalizeRegisteredProject(group: RegisteredProject): RegisteredProject {
  return {
    ...group,
    runtime_id: group.runtime_id || DEFAULT_RUNTIME_ID,
    agent_id: group.agent_id || group.folder,
  };
}

function inferChannelName(chatJid: string): string | undefined {
  if (chatJid.startsWith('dc:')) return 'discord';
  if (chatJid.startsWith('tg:')) return 'telegram';
  if (chatJid.startsWith('web:')) return 'http';
  if (chatJid.startsWith('fs:')) return 'feishu';
  return 'whatsapp';
}

function resolveSessionForChat(chatJid: string, group: RegisteredProject) {
  const normalizedGroup = normalizeRegisteredProject(group);
  const existing = getSessionByChatJid(chatJid);
  if (existing) return existing;

  return ensureSession({
    runtime_id: normalizedGroup.runtime_id,
    agent_id: normalizedGroup.agent_id!,
    session_id: chatJid,
    chat_jid: chatJid,
    channel: inferChannelName(chatJid),
    agent_name: normalizedGroup.name,
    agent_folder: normalizedGroup.folder,
  });
}

async function processMessages(chatJid: string): Promise<boolean> {
  let group = registeredProjects[chatJid];
  if (!group) return false;
  group = normalizeRegisteredProject(group);

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
  const session = resolveSessionForChat(chatJid, group);
  const jobId =
    latestMsg?.job_id ||
    latestMsg?.id ||
    `${session.session_id}-${newest}`;
  const scopedLogger = logger.child({
    runtime_id: session.runtime_id,
    agent_id: session.agent_id,
    session_id: session.session_id,
    job_id: jobId,
    chat_jid: chatJid,
  });

  // Mind evolution: natural conversation updates persona and memory (non-blocking)
  if (latestMsg?.content && !latestMsg.content.trim().startsWith('/mind')) {
    const isAdminUser = latestMsg.sender
      ? MIND_ADMIN_USERS.includes(latestMsg.sender)
      : false;
    recordUserInteraction({
      chat_jid: chatJid,
      channel: chatJid.startsWith('dc:')
        ? 'discord'
        : chatJid.startsWith('tg:')
          ? 'telegram'
          : undefined,
      role: 'user',
      content: latestMsg.content,
      timestamp: latestMsg.timestamp,
      sender: latestMsg.sender,
      sender_name: latestMsg.sender_name,
      is_admin: isAdminUser,
    }).catch((err) => {
      logger.warn({ err }, 'mind updater failed (ignored)');
    });
  }

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

  scopedLogger.info(
    { messageCount: messages.length, rawText: rawText.slice(0, 200) },
    'processMessages: starting',
  );

  try {
    // Show typing indicator while we process
    routeSetTyping(channels, chatJid, true);

    // Mind control plane: /mind status, lock, unlock, set, package, diff, rollback
    const latestText = messages[messages.length - 1]?.content?.trim() || '';
    if (latestText.startsWith('/mind')) {
      const parts = latestText.split(/\s+/);
      const cmd = parts[1] || 'status';

      if (cmd === 'status') {
        const state = mindStatus();
        await sendFn(
          chatJid,
          `🧠 Mind status\n- version: ${state.version}\n- lifecycle: ${state.lifecycle}\n- persona: ${JSON.stringify(state.persona)}`,
        );
        return true;
      }

      if (cmd === 'enroll') {
        const sub = parts[2] || 'status';
        if (sub === 'status') {
          const e = readEnrollmentState(CONTROL_PLANE_RUNTIME_ID || undefined);
          await sendFn(
            chatJid,
            `🔐 Enrollment status\n- runtime_id: ${e.runtime_id}\n- fingerprint: ${e.runtime_fingerprint}\n- trust_state: ${e.trust_state}\n- token_expires_at: ${e.token_expires_at || 'none'}\n- failed_attempts: ${e.failed_attempts}${e.frozen_until ? `\n- frozen_until: ${e.frozen_until}` : ''}`,
          );
          return true;
        }

        if (sub === 'verify') {
          const token = parts[3];
          if (!token) {
            await sendFn(chatJid, 'Usage: /mind enroll verify <token>');
            return true;
          }
          const e = readEnrollmentState(CONTROL_PLANE_RUNTIME_ID || undefined);
          const result = verifyEnrollmentToken({
            token,
            runtimeFingerprint: e.runtime_fingerprint,
            runtimeId: CONTROL_PLANE_RUNTIME_ID || undefined,
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

      const isMainGroup = !!group.isMain;

      if (cmd === 'lock') {
        if (!isMainGroup) {
          await sendFn(chatJid, '⛔ /mind lock requires main control group');
          return true;
        }
        const state = lockMind();
        logger.info(
          { chatJid, cmd: '/mind lock', version: state.version },
          'mind governance command',
        );
        await sendFn(chatJid, `✅ Mind locked at version ${state.version}`);
        return true;
      }

      if (cmd === 'unlock') {
        if (!isMainGroup) {
          await sendFn(chatJid, '⛔ /mind unlock requires main control group');
          return true;
        }
        const state = unlockMind();
        logger.info(
          { chatJid, cmd: '/mind unlock', lifecycle: state.lifecycle },
          'mind governance command',
        );
        await sendFn(
          chatJid,
          `✅ Mind unlocked (lifecycle=${state.lifecycle})`,
        );
        return true;
      }

      if (cmd === 'set') {
        const field = parts[2];
        const value = parts.slice(3).join(' ').trim();
        if (!field || !value) {
          await sendFn(
            chatJid,
            'Usage: /mind set <tone|verbosity|emoji> <value>',
          );
          return true;
        }

        const patch: any = {};
        if (field === 'tone') patch.tone = value;
        else if (field === 'verbosity') patch.verbosity = value;
        else if (field === 'emoji')
          patch.emoji = value === 'true' || value === 'on' || value === '1';
        else {
          await sendFn(chatJid, `Unsupported field: ${field}`);
          return true;
        }

        const state = setMindPersonaPatch(patch);
        await sendFn(
          chatJid,
          `✅ Mind persona updated: ${JSON.stringify(state.persona)}`,
        );
        return true;
      }

      if (cmd === 'package') {
        const sub = parts[2] || 'create';
        if (sub === 'create') {
          if (!isMainGroup) {
            await sendFn(
              chatJid,
              '⛔ /mind package create requires main control group',
            );
            return true;
          }
          const pkg = createPackage('Created via /mind package create');
          logger.info(
            { chatJid, cmd: '/mind package create', version: pkg.version },
            'mind governance command',
          );
          await sendFn(
            chatJid,
            `📦 Mind package created: v${pkg.version} (${pkg.id})`,
          );
          return true;
        }
        if (sub === 'list') {
          const pkgs = listPackages(5);
          const lines = pkgs
            .map((p) => `- v${p.version} [${p.lifecycle}] ${p.id}`)
            .join('\n');
          await sendFn(
            chatJid,
            `📚 Recent mind packages\n${lines || '(empty)'}`,
          );
          return true;
        }
      }

      if (cmd === 'diff') {
        const from = Number(parts[2]);
        const to = Number(parts[3]);
        if (!Number.isFinite(from) || !Number.isFinite(to)) {
          await sendFn(chatJid, 'Usage: /mind diff <fromVersion> <toVersion>');
          return true;
        }
        const diff = diffMindVersions(from, to);
        await sendFn(chatJid, `🧾 Mind diff ${from} -> ${to}\n${diff}`);
        return true;
      }

      if (cmd === 'rollback') {
        if (!isMainGroup) {
          await sendFn(
            chatJid,
            '⛔ /mind rollback requires main control group',
          );
          return true;
        }
        const version = Number(parts[2]);
        if (!Number.isFinite(version)) {
          await sendFn(chatJid, 'Usage: /mind rollback <version>');
          return true;
        }
        const state = rollbackPackage(version);
        if (!state) {
          await sendFn(chatJid, `❌ Mind package version ${version} not found`);
          return true;
        }
        logger.info(
          { chatJid, cmd: '/mind rollback', version: state.version },
          'mind governance command',
        );
        await sendFn(
          chatJid,
          `↩️ Rolled back to mind version ${state.version}`,
        );
        return true;
      }
    }

    // Check if we have a valid workspace for this group
    const workspace = session.workspace_path;
    const hasWorkspace = fs.existsSync(workspace);
    scopedLogger.info(
      { workspace, hasWorkspace },
      'processMessages: workspace check',
    );

    const aiMessages = recentMessages.map((m) => ({
      role: (m.sender_name === ASSISTANT_NAME ? 'assistant' : 'user') as
        | 'assistant'
        | 'user',
      content: m.content,
    }));

    try {
      await runAgent({
        group,
        session: {
          ...session,
          job_id: jobId,
        },
        messages: aiMessages,
        onProgress: async (text, elapsed) => {
          const secs = Math.round(elapsed / 1000);
          await sendFn(chatJid, `⏳ (${secs}s) Working on it...`);
        },
        onReply: async (text) => {
          await sendFn(chatJid, text);
        },
      });
      return true;
    } catch (err: any) {
      scopedLogger.error({ err }, 'Agent failed');
      await sendFn(
        chatJid,
        `❌ **Agent Error**\n\`\`\`\n${err.message}\n\`\`\``,
      );
      return false;
    }
  } catch (err: any) {
    logger.error(
      {
        runtime_id: session.runtime_id,
        agent_id: session.agent_id,
        session_id: session.session_id,
        job_id: jobId,
        chat_jid: chatJid,
        err,
      },
      'processMessages: unexpected error',
    );
    return false;
  } finally {
    routeSetTyping(channels, chatJid, false);
  }
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
  registeredProjects = Object.fromEntries(
    Object.entries(groups).map(([jid, group]) => [
      jid,
      normalizeRegisteredProject(group),
    ]),
  );
}

function registerProject(jid: string, group: RegisteredProject): void {
  const normalizedGroup = normalizeRegisteredProject(group);
  // Ensure a chats row exists for this JID before registering,
  // so that subsequent message storage doesn't fail with FK constraint.
  storeChatMetadata(jid, new Date().toISOString(), normalizedGroup.name);
  setRegisteredProject(jid, normalizedGroup);
  registeredProjects[jid] = normalizedGroup;
  scheduleSupabasePush();
  logger.info(
    {
      jid,
      runtime_id: normalizedGroup.runtime_id,
      agent_id: normalizedGroup.agent_id,
      folder: normalizedGroup.folder,
    },
    'Group registered',
  );
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
    registeredProjects[jid] = normalizeRegisteredProject(group);
  }
  logger.info(
    { count: Object.keys(registeredProjects).length },
    'Groups loaded',
  );

  const dbSessions = getAllSessions();
  logger.info({ count: dbSessions.length }, 'Sessions loaded');

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
  initDatabase();
  logger.info('Database initialized');
  if (isSupabaseConfigured()) {
    await pullFromSupabase();
    startPeriodicSupabasePush();
  }
  loadState();

  const channelOpts: ChannelOpts = {
    onMessage: (_chatJid: string, msg: NewMessage) => storeMessage(msg),
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
  const toConnect =
    enabledFromConfig.length > 0
      ? registeredChannelNames.filter((n) => enabledFromConfig.includes(n))
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
        id: `bot-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
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
