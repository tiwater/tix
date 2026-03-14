/**
 * TiClaw Main Entry Point
 */

import './channels/index.js'; // Trigger channel self-registration

import path from 'path';
import { randomUUID } from 'crypto';
import {
  ASSISTANT_NAME,
  POLL_INTERVAL,
  TICLAW_HOME,
  TRIGGER_PATTERN,
} from './core/config.js';
import {
  getAllChats,
  getAllRegisteredProjects,
  getAllSessions,
  getNewMessages,
  getMessagesSince,
  getRouterState,
  initDatabase,
  setRegisteredProject,
  setRouterState,
  storeChatMetadata,
  storeMessage,
} from './core/db.js';
import { logger } from './core/logger.js';
import {
  getChannelFactory,
  getRegisteredChannelNames,
} from './channels/registry.js';
import { routeOutbound, routeSetTyping } from './router.js';
import { runAgent } from './run-agent.js';
import { startPeriodicSupabasePush, pullFromSupabase, isSupabaseConfigured } from './sync/supabase-sync.js';
import { startSchedulerLoop } from './task-scheduler.js';
import { CommandHub } from './core/command-hub.js';
import { ensureSession } from './core/db.js';
import {
  AvailableProject,
  Channel,
  ChannelOpts,
  NewMessage,
  RegisteredProject,
} from './core/types.js';

let messageLoopRunning = false;
let registeredProjects: Record<string, RegisteredProject> = {};
const lastAgentTimestamp: Record<string, string> = {};
const activeAgentLocks = new Map<string, Promise<any>>();
const channels: Channel[] = [];
const sessions: Record<string, string> = {};

// Initialize CommandHub
CommandHub.init();

async function processMessages(chatJid: string): Promise<boolean> {
  try {
    const group = registeredProjects[chatJid];
    if (!group) return false;

    const lastTs = lastAgentTimestamp[chatJid] || '';
    const { messages } = getNewMessages([chatJid], lastTs, ASSISTANT_NAME);
    if (messages.length === 0) return false;

    const message = messages[messages.length - 1];
    const channel = channels.find((c) => c.ownsJid(chatJid));
    if (!channel) return false;

    routeSetTyping(channels, chatJid, true);

    try {
      // 1. Intercept Slash Commands
      const commandRes = await CommandHub.tryExecute(message.content);
      if (commandRes) {
        if (commandRes.type === 'card') {
          await channel.sendMessage(chatJid, commandRes.content, { card: commandRes.data });
        } else {
          await channel.sendMessage(chatJid, commandRes.content);
        }
        lastAgentTimestamp[chatJid] = new Date().toISOString();
        return true;
      }

      // 2. Fallback to LLM Agent
      await runAgent({
        agentId: group.folder,
        sessionId: message.session_id || chatJid,
        message: message.content,
        taskId: message.task_id || randomUUID(),
        onReply: async (text) => {
          await channel.sendMessage(chatJid, text);
        },
      });

      lastAgentTimestamp[chatJid] = new Date().toISOString();
      return true;
    } finally {
      routeSetTyping(channels, chatJid, false);
    }
  } catch (err: any) {
    logger.error({ err, chatJid }, 'Error processing messages');
    return false;
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

function registerProject(jid: string, group: RegisteredProject): void {
  storeChatMetadata(jid, new Date().toISOString(), group.name);
  setRegisteredProject(jid, group);
  registeredProjects[jid] = group;
  logger.info({ jid, folder: group.folder }, 'Group registered');
}

async function startMessageLoop(): Promise<void> {
  if (messageLoopRunning) return;
  messageLoopRunning = true;
  while (messageLoopRunning) {
    try {
      const jids = Object.keys(registeredProjects);
      for (const jid of jids) {
        if (!activeAgentLocks.has(jid)) {
          const p = processMessages(jid).finally(() => activeAgentLocks.delete(jid));
          activeAgentLocks.set(jid, p);
        }
      }
    } catch (err) {
      logger.error({ err }, 'Message loop error');
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL));
  }
}

async function main(): Promise<void> {
  initDatabase();
  loadState();

  const channelOpts: ChannelOpts = {
    onMessage: (_chatJid: string, msg: NewMessage) => storeMessage(msg),
    onChatMetadata: (jid, ts, name, channel, isGroup) => storeChatMetadata(jid, ts, name, channel, isGroup),
    registeredProjects: () => registeredProjects,
    onGroupRegistered: (jid, group) => registerProject(jid, group),
  };

  const channelNames = getRegisteredChannelNames();
  for (const name of channelNames) {
    const factory = getChannelFactory(name);
    const channel = factory?.(channelOpts);
    if (channel) {
      await channel.connect();
      channels.push(channel);
    }
  }

  startMessageLoop();
  logger.info(`TiClaw v1.3.0 is running`);
}

function loadState(): void {
  const groups = getAllRegisteredProjects();
  for (const [jid, group] of Object.entries(groups)) {
    registeredProjects[jid] = group;
  }
}

main().catch(console.error);
