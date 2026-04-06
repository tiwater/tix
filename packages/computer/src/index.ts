import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

import {
  TC_CODING_CLI,
  ASSISTANT_NAME,
  TIX_HOME,
  IDLE_TIMEOUT,
  POLL_INTERVAL,
  TRIGGER_PATTERN,
  COMPUTER_HOSTNAME,
  SKILLS_CONFIG,
  MIND_ADMIN_USERS,
  configureClawComputer,
  initializeDataDirs,
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
  getSessionForAgent,
  initStore,
  cleanupStaleSessions,
  setRegisteredProject,
  setRouterState,
  storeChatMetadata,
  storeMessage,
  resolveFromChatJid,
} from './core/store.js';

import { logger } from './core/logger.js';
import { executeSkillsCommand } from './skills/commands.js';
import {
  readEnrollmentState,
  verifyEnrollmentToken,
} from './core/enrollment.js';
import {
  approvePairing,
  ensurePendingPairing,
  getBinding,
  listBindings,
  listPendingPairings,
  pairingIdentity,
  removeBinding,
  upsertBinding,
} from './core/pairing.js';
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

import { AgentComputer } from './core/computer.js';
import { Gateway } from './core/gateway.js';
import { broadcastToChat } from './channels/http.js';
import { getEnabledChannelsFromConfig, readEnvFile } from './core/env.js';
import {
  findLatestInterruptIndex,
  trimMessagesAfterInterrupt,
} from './core/interrupts.js';
import {
  isSupabaseConfigured,
  pullFromSupabase,
  scheduleSupabasePush,
  startPeriodicSupabasePush,
} from './sync/supabase-sync.js';
import {
  appendStreamChunk,
  createStreamState,
} from './core/streaming.js';
import { parseProgressEvent, formatProgressText, progressKeyFromEvent } from './core/progress.js';

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
  onSessionStop?: (
    agentId: string,
    sessionId: string,
    actor?: string,
  ) => {
    ok: boolean;
    code: string;
    message: string;
    chatJid?: string;
  };
}

// Global state
let registeredProjects: Record<string, RegisteredProject> = {};
const sessions: Record<string, string> = {}; // folder -> sessionId
const lastAgentTimestamp: Record<string, string> = {}; // chatJid -> iso
const channels: Channel[] = [];
const activeComputers = new Map<string, AgentComputer>();

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

// Pending-run flags: if a second message arrives while the lock is held,
// set the flag so the run drains immediately after the current one finishes.
const pendingRuns = new Set<string>();

function requestSessionStop(
  agentId: string,
  sessionId: string,
  actor = 'unknown',
): {
  ok: boolean;
  code: string;
  message: string;
  chatJid?: string;
} {
  const session = getSessionForAgent(agentId, sessionId);
  const chatJid =
    session?.source_ref?.trim() || `web:${agentId}:${sessionId}`;
  const computer = activeComputers.get(chatJid);

  if (!computer) {
    return {
      ok: false,
      code: 'session_not_running',
      message: `Session "${sessionId}" is not currently running.`,
      chatJid,
    };
  }

  logger.info(
    { agentId, sessionId, chatJid, actor },
    'Stop requested for active session',
  );
  computer.interrupt();

  return {
    ok: true,
    code: 'stop_requested',
    message: `Stop requested for session "${sessionId}".`,
    chatJid,
  };
}

/**
 * Schedule a processMessages run for a chatJid.
 * - If no run is in progress, starts one immediately.
 * - If one is already running, marks a pending flag so a drain run kicks off
 *   as soon as the current one finishes — no message is silently dropped.
 */
function scheduleRun(chatJid: string): void {
  if (!activeAgentLocks.has(chatJid)) {
    const agentPromise = runAndDrain(chatJid);
    activeAgentLocks.set(chatJid, agentPromise);
  } else {
    const sinceTimestamp = lastAgentTimestamp[chatJid] || '';
    const pending = getMessagesSince(chatJid, sinceTimestamp, ASSISTANT_NAME);
    if (pending.length === 0) return;

    const latestInterruptIndex = findLatestInterruptIndex(pending);
    if (latestInterruptIndex >= 0) {
      const interruptMsg = pending[latestInterruptIndex];
      lastAgentTimestamp[chatJid] = interruptMsg.timestamp;
      setRouterState(chatJid, interruptMsg.timestamp);

      logger.info(
        {
          chatJid,
          interruptTimestamp: interruptMsg.timestamp,
          hasActiveComputer: activeComputers.has(chatJid),
        },
        'Interrupt control message received while run is active',
      );

      activeComputers.get(chatJid)?.interrupt();
    }

    const hasMessagesAfterInterrupt =
      latestInterruptIndex >= 0
        ? latestInterruptIndex < pending.length - 1
        : pending.length > 0;

    if (hasMessagesAfterInterrupt) {
      // Mark that we need another run after the current one finishes
      pendingRuns.add(chatJid);
    }
  }
}

/** Run processMessages, then drain any pending message that arrived mid-run. */
async function runAndDrain(chatJid: string): Promise<void> {
  try {
    await processMessages(chatJid);
  } finally {
    activeAgentLocks.delete(chatJid);
    if (pendingRuns.has(chatJid)) {
      pendingRuns.delete(chatJid);
      scheduleRun(chatJid);
    }
  }
}


async function processMessages(chatJid: string): Promise<boolean> {
  let group = registeredProjects[chatJid];
  if (!group) {
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

  // Resolve or create a session for this chat so directories exist.
  // IMPORTANT: always resolve agentId + sessionId from the JID — never use
  // chatJid itself as session_id, or the full JID gets stored and re-prefixed
  // on every subsequent call, making the key grow indefinitely.
  let agentId = getBinding(chatJid)?.agent_id || (group as any).agent_id || group.folder;
  let sessionId: string;
  const resolved = resolveFromChatJid(chatJid);
  if (resolved) {
    agentId = resolved.agentId;
    sessionId = resolved.sessionId;
  } else {
    // Fallback for unrecognised JID formats: split on ':' and use last segment
    const parts = chatJid.split(':');
    sessionId = parts.length >= 2 ? parts.slice(1).join(':') : chatJid;
    if (agentId === 'unknown' && parts.length >= 2) {
      agentId = parts[1];
    }
  }
  const channel = chatJid.startsWith('dc:')
    ? 'discord'
    : chatJid.startsWith('web:')
      ? 'http'
      : chatJid.startsWith('feishu:') || chatJid.startsWith('fs:')
        ? 'feishu'
        : 'unknown';
  const session = ensureSession({
    agent_id: agentId,
    session_id: sessionId,
    channel,
    agent_name: group.name,
    source_ref: chatJid,
  });

  const sinceTimestamp = lastAgentTimestamp[chatJid] || '';
  const messages = getMessagesSince(chatJid, sinceTimestamp, ASSISTANT_NAME);

  logger.info(
    { chatJid, sinceTimestamp, retrievedCount: messages.length },
    'processMessages: retrieved messages',
  );

  if (messages.length === 0) return true;

  // Update last timestamp BEFORE handling control messages to avoid loops on failure
  const newest = messages[messages.length - 1].timestamp;
  lastAgentTimestamp[chatJid] = newest;
  setRouterState(chatJid, newest);

  // Transform messages to the format expected by computer.run
  const runnableMessages = trimMessagesAfterInterrupt(messages);
  if (runnableMessages.length === 0) {
    logger.info(
      { chatJid, messageCount: messages.length },
      'processMessages: consumed interrupt control message without dispatching to agent',
    );
    return true;
  }

  // Transform messages to the format expected by computer.run
  // is_from_me=true means the message is from the assistant (role: assistant)
  // is_from_me=false means the message is from the user (role: user)
  const aiMessages = runnableMessages.map((m) => ({
    role: m.is_from_me ? 'assistant' : 'user',
    content: m.content,
  }));

  // Extract latest message for processing
  const latestMsg = runnableMessages[runnableMessages.length - 1];

  logger.info(
    { chatJid, messageCount: messages.length },
    'processMessages: starting',
  );

  try {
    // Show typing indicator while we process
    routeSetTyping(channels, chatJid, true);

    // Enrollment control plane: /enroll status | /enroll verify <token>
    const latestText = messages[messages.length - 1]?.content?.trim() || '';

    // Web channel is already API-key authenticated — skip pairing gate.
    // Pairing is only required for external channels (Feishu, Discord, etc.)
    // where untrusted users may connect.
    const isWebChannel = chatJid.startsWith('web:');
    const existingBinding = isWebChannel
      ? { agent_id: agentId, kind: 'user' as const, updated_at: new Date().toISOString() }
      : getBinding(chatJid);
    if (!existingBinding) {
      if (latestText.startsWith('/pair')) {
        const parts = latestText.split(/\s+/);
        const sub = (parts[1] || 'status').toLowerCase();
        if (sub === 'status') {
          const pending = ensurePendingPairing(chatJid);
          await sendFn(
            chatJid,
            `🔐 This identity is not paired yet. Pair code: ${pending.pair_code}\nAsk an admin to approve it with /pair approve ${pending.pair_code}${pending.requested_agent_id ? ` ${pending.requested_agent_id}` : ''}\nExpires at: ${pending.expires_at}`,
          );
          return true;
        }

        if (sub === 'approve') {
          const code = parts[2];
          const targetAgentId = parts[3];
          if (!isAdminActor(latestMsg?.sender)) {
            await sendFn(chatJid, 'Only configured admins can approve pair codes.');
            return true;
          }
          if (!code) {
            await sendFn(chatJid, 'Usage: /pair approve <code> [agent_id]');
            return true;
          }
          const approved = approvePairing(code, latestMsg?.sender || 'unknown-admin', targetAgentId);
          if (!approved) {
            await sendFn(chatJid, `Unknown pair code: ${code}`);
            return true;
          }
          if (approved.status === 'expired') {
            await sendFn(chatJid, `Pair code ${code.toUpperCase()} has expired.`);
            return true;
          }
          const boundAgentId = approved.bound_agent_id || approved.requested_agent_id;
          upsertBinding({
            chatJid: approved.chat_jid,
            agentId: boundAgentId,
            approvedBy: latestMsg?.sender || 'unknown-admin',
            pairCode: approved.pair_code,
          });
          await sendFn(
            chatJid,
            `✅ Pairing approved for ${approved.chat_jid} -> ${boundAgentId} (code ${approved.pair_code})`,
          );
          return true;
        }

        await sendFn(chatJid, 'Supported pairing commands: /pair status, /pair approve <code> [agent_id]');
        return true;
      }

      const pending = ensurePendingPairing(chatJid);
      await sendFn(
        chatJid,
        `🔐 This identity is not paired with an agent yet. Pair code: ${pending.pair_code}\nReply with /pair status to see the code again. An admin must approve it before normal conversation is enabled.`,
      );
      return true;
    }

    if (latestText.startsWith('/pair')) {
      const parts = latestText.split(/\s+/);
      const sub = (parts[1] || 'status').toLowerCase();
      if (sub === 'status') {
        await sendFn(
          chatJid,
          `✅ Paired with agent ${existingBinding.agent_id}\nBinding kind: ${existingBinding.kind}\nUpdated at: ${existingBinding.updated_at}`,
        );
        return true;
      }

      if (sub === 'list') {
        if (!isAdminActor(latestMsg?.sender)) {
          await sendFn(chatJid, 'Only configured admins can list bindings.');
          return true;
        }
        const bindings = listBindings();
        const pending = listPendingPairings().filter((item) => item.status === 'pending');
        const lines = [
          `Bindings (${bindings.length})`,
          ...bindings.slice(0, 20).map((item) => `- ${item.chat_jid} -> ${item.agent_id} (${item.kind})`),
          ``,
          `Pending pairings (${pending.length})`,
          ...pending.slice(0, 20).map((item) => `- ${item.pair_code} :: ${item.chat_jid} -> ${item.requested_agent_id} (exp ${item.expires_at})`),
        ];
        await sendFn(chatJid, lines.join('\n'));
        return true;
      }

      if (sub === 'unbind') {
        if (!isAdminActor(latestMsg?.sender)) {
          await sendFn(chatJid, 'Only configured admins can remove bindings.');
          return true;
        }
        const targetChatJid = parts[2] || chatJid;
        const removed = removeBinding(targetChatJid);
        await sendFn(
          chatJid,
          removed ? `🧹 Removed binding for ${targetChatJid}` : `No binding found for ${targetChatJid}`,
        );
        return true;
      }

      await sendFn(chatJid, 'Supported pairing commands: /pair status, /pair list, /pair unbind [chat_jid]');
      return true;
    }

    if (latestText.startsWith('/enroll')) {
      const parts = latestText.split(/\s+/);
      const sub = parts[1] || 'status';
      if (sub === 'status') {
        const e = readEnrollmentState(COMPUTER_HOSTNAME || undefined);
        await sendFn(
          chatJid,
          `🔐 Enrollment status\n- computer: ${e.computer_id}\n- fingerprint: ${e.computer_fingerprint}\n- trust_state: ${e.trust_state}\n- token_expires_at: ${e.token_expires_at || 'none'}\n- failed_attempts: ${e.failed_attempts}${e.frozen_until ? `\n- frozen_until: ${e.frozen_until}` : ''}`,
        );
        return true;
      }

      if (sub === 'verify') {
        const token = parts[2];
        if (!token) {
          await sendFn(chatJid, 'Usage: /enroll verify <token>');
          return true;
        }
        const e = readEnrollmentState(COMPUTER_HOSTNAME || undefined);
        const result = verifyEnrollmentToken({
          token,
          computerFingerprint: e.computer_fingerprint,
          computerId: COMPUTER_HOSTNAME || undefined,
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
    // (group is guaranteed to be set now because of our fallback logic at the top)
    const workspace = getFactoryPath(group);
    const hasWorkspace = fs.existsSync(workspace);
    logger.info(
      { chatJid, workspace, hasWorkspace },
      'processMessages: workspace check',
    );

    try {
      let statusMessageId: string | null = null;
      let lastProgressSentAt = 0;
      let lastProgressKey = '';
      let lastProgressEvent: Record<string, unknown> | null = null;
      const runStartedAt = Date.now();
      let heartbeatInFlight = false;
      let heartbeatTimer: NodeJS.Timeout | null = null;

      const emitProgress = async (info: import('./core/progress.js').ProgressInfo) => {
        if (chatJid.startsWith('web:')) {
          broadcastToChat(chatJid, {
            type: 'progress',
            category: info.category,
            skill: info.skill,
            tool: info.tool,
            args: info.args,
            target: info.target,
            elapsed_s: info.elapsed_s,
          });
        }
        // Non-web channels do not receive progressive UI string updates
        // The framework strictly transmits structured data.
      };

      const emitProgressHeartbeat = async () => {
        if (heartbeatInFlight) return;
        heartbeatInFlight = true;
        try {
          const elapsed = Date.now() - runStartedAt;
          const heartbeatBase = lastProgressEvent
            ? {
                ...lastProgressEvent,
                elapsed_ms: elapsed,
              }
            : {
                phase: 'assistant',
                action: 'thinking',
                elapsed_ms: elapsed,
              };
          let heartbeatInfo = parseProgressEvent(heartbeatBase);
          if (!heartbeatInfo) {
            heartbeatInfo = parseProgressEvent({
              phase: 'assistant',
              action: 'thinking',
              elapsed_ms: elapsed,
            });
          }
          if (!heartbeatInfo) return;
          await emitProgress(heartbeatInfo);
        } catch (err) {
          logger.debug({ err, chatJid }, 'Progress heartbeat failed');
        } finally {
          heartbeatInFlight = false;
        }
      };

      const taskId = `run-${Date.now()}`;
      const streamState = createStreamState(`${chatJid}:${taskId}`);
      heartbeatTimer = setInterval(
        () => {
          void emitProgressHeartbeat();
        },
        chatJid.startsWith('web:') ? 1000 : 15_000,
      );

      try {
        const computer = new AgentComputer(
          agentId,
          { ...session, task_id: taskId }.session_id,
          {
            onStateChange: async (state) => {
              const eventData: Record<string, unknown> = {
                phase: state.activity?.phase,
                action: state.activity?.action,
                target: state.activity?.target,
                elapsed_ms: state.activity?.elapsed_ms,
                status: state.status,
              };
              lastProgressEvent = { ...eventData };

              // Broadcast computer_state for all status transitions so
              // consumers get real-time status updates.
              if (chatJid.startsWith('web:')) {
                broadcastToChat(chatJid, {
                  type: 'computer_state',
                  chat_jid: chatJid,
                  ...state,
                });
              }

              if (
                chatJid.startsWith('web:') &&
                (state.status === 'interrupted' || state.status === 'error')
              ) {
                if (streamState.nextSeq > 1) {
                  broadcastToChat(chatJid, {
                    type: 'stream_end',
                    stream_id: streamState.streamId,
                  });
                }
                broadcastToChat(chatJid, { type: 'progress_end' });
              }

              // Forward streaming text deltas to SSE clients
              if (
                eventData.phase === 'stream_event' &&
                eventData.action === 'speaking' &&
                typeof eventData.target === 'string'
              ) {
                const frame = appendStreamChunk(streamState, eventData.target);
                if (frame) {
                  broadcastToChat(chatJid, {
                    type: 'stream_delta',
                    ...frame,
                  });
                }
              }

              const progressInfo = parseProgressEvent(eventData);
              if (!progressInfo) return;

              const now = Date.now();
              const targetKey =
                typeof eventData.target === 'string'
                  ? eventData.target.slice(0, 120)
                  : '';
              const progressKey = `${progressKeyFromEvent(eventData)}|${targetKey}`;

              const isWeb = chatJid.startsWith('web:');
              const throttleMs = isWeb ? 1000 : 10_000;

              const shouldSend =
                !lastProgressSentAt ||
                progressKey !== lastProgressKey ||
                now - lastProgressSentAt >= throttleMs;

              if (!shouldSend) return;

              lastProgressSentAt = now;
              lastProgressKey = progressKey;
              await emitProgress(progressInfo);
            },
            onFile: async (filePath, caption) => {
              try {
                await routeOutboundFile(channels, chatJid, filePath, caption);
              } catch (err) {
                logger.warn({ err, chatJid, filePath }, 'Failed to send file');
              }
            },
            onReply: async (text) => {
              // Stop heartbeat immediately — the run is complete and
              // we don't want stale progress events re-triggering the
              // "thinking" state on the frontend after stream_end.
              if (heartbeatTimer) {
                clearInterval(heartbeatTimer);
                heartbeatTimer = null;
              }

              // Finalize streaming: emit stream_end so consumers
              // know the streaming phase is complete.
              if (chatJid.startsWith('web:') && streamState.nextSeq > 1) {
                broadcastToChat(chatJid, {
                  type: 'stream_end',
                  stream_id: streamState.streamId,
                });
              }

              // Clear progress indicators
              if (chatJid.startsWith('web:')) {
                broadcastToChat(chatJid, { type: 'progress_end' });
              } else if (statusMessageId) {
                try {
                  await routeEditMessage(
                    channels,
                    chatJid,
                    statusMessageId,
                    'Done, sending final reply...',
                  );
                } catch {
                  // Safe to ignore; final answer will still be delivered.
                }
              }

              // Deliver the final message through the channel.
              // Pass stream_id as message_id so the frontend can correlate
              // the final message with the streaming placeholder.
              await sendFn(chatJid, text, {
                message_id: streamState.streamId,
              });
            },
          },
        );

        activeComputers.set(chatJid, computer);
        try {
          await computer.run(aiMessages, taskId, { model: latestMsg?.model });
        } finally {
          if (activeComputers.get(chatJid) === computer) {
            activeComputers.delete(chatJid);
          }
        }
      } finally {
        if (heartbeatTimer) {
          clearInterval(heartbeatTimer);
          heartbeatTimer = null;
        }
      }
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
  return path.join(TIX_HOME, 'factory', group.folder);
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

          scheduleRun(chatJid);
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
      scheduleRun(chatJid);
    }
  }
}

let sendFn: (
  jid: string,
  text: string,
  options?: { embeds?: any[]; message_id?: string },
) => Promise<void>;
let createChannelFn: (fromJid: string, name: string) => Promise<string | null>;

async function main(): Promise<void> {
  const productName = process.env.TIX_PRODUCT_NAME || 'Supen';
  logger.info(`${productName} Computer starting`);

  initStore();
  cleanupStaleSessions();
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
      // Event-driven: immediately process incoming messages instead of waiting for poll
      if (!msg.is_from_me) {
        scheduleRun(chatJid);
      }
    },
    onSessionStop: (agentId: string, sessionId: string, actor?: string) =>
      requestSessionStop(agentId, sessionId, actor),
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

  // ── Gateway uplink (core infrastructure, N:1 — many nodes → one gateway) ──
  const gateway = new Gateway({
    onMessage: (chatJid, msg) => channelOpts.onMessage(chatJid, msg),
    onChatMetadata: (chatJid, timestamp, name, channel, isGroup) =>
      channelOpts.onChatMetadata(chatJid, timestamp, name, channel, isGroup),
  });
  await gateway.connect();
  // Add to channels so outbound routing (sendMessage/ownsJid) works
  channels.push(gateway as any);

  // ── Consumer channels ──
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
          logger.error({ channel: name, err }, 'Failed to connect channel — skipping');
        }
      }
    }
  }
  sendFn = async (jid: string, text: string, options?: { embeds?: any[]; message_id?: string }) => {
    const messageId = options?.message_id || `bot-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    await routeOutbound(channels, jid, text, { ...options, message_id: messageId });
    const ts = new Date().toISOString();
    lastAgentTimestamp[jid] = ts;
    setRouterState(jid, ts);
    // Store bot response so conversation history includes assistant turns
    if (text.trim()) {
      storeMessage({
        id: messageId,
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
  // SECURITY: We do NOT grant approveLevel3 here. Any skill listed in
  // defaultEnabled that requires Level 3 will be skipped at startup with a
  // warning. Level 3 skills require explicit operator approval via the CLI.
  try {
    const registry = new SkillsRegistry(SKILLS_CONFIG);
    const defaultSkills = SKILLS_CONFIG.defaultEnabled;
    const ctx = { actor: 'system-init', isAdmin: true, approveLevel3: false };
    for (const skillName of defaultSkills) {
      try {
        if (!registry.getInstalled(skillName)) {
          registry.installSkill(skillName, ctx);
        }
        const installed = registry.getInstalled(skillName);
        if (!installed) continue;
        // Issue #50: skip Level 3 skills — they must be explicitly approved
        if (installed.permissionLevel === 3) {
          logger.warn(
            { skill: skillName },
            'Skipping auto-enable of Level 3 default skill — explicit approval required. Use `supen-node skills enable --approve` to enable it.',
          );
          continue;
        }
        if (!installed.enabled) {
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
    enqueueMessage: channelOpts.onMessage,
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

  logger.info(`${productName} Computer running (trigger: @${ASSISTANT_NAME})`);
}

export interface ClawComputerConfig {
  productName?: string;
  dataDir?: string;
}

export class ClawComputer {
  constructor(config: ClawComputerConfig = {}) {
    if (config.productName) {
      process.env.TIX_PRODUCT_NAME = config.productName;
    }
    configureClawComputer({ dataDir: config.dataDir });
  }

  async start(): Promise<void> {
    initializeDataDirs();
    await main();
  }
}

import url from 'node:url';
if (import.meta.url === url.pathToFileURL(process.argv[1]).href) {
  new ClawComputer().start().catch((err) => {
    console.error('Fatal computer error:', err);
    process.exit(1);
  });
}
