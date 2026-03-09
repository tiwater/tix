/**
 * TiClaw mind system — persona & memory state management.
 *
 * Intent classification has been removed; the Claude Agent SDK executor
 * handles persona/memory evolution directly through conversation.
 * This module is now purely about SQLite state + file sync.
 */

import {
  createMindPackage,
  getMindState,
  listMindPackages,
  rollbackMindPackage,
  storeInteractionEvent,
  updateMindState,
} from './db.js';
import { MIND_LOCK_MODE } from './config.js';
import { syncMindStateToFiles } from './mind-files.js';
import { scheduleSupabasePush } from '../sync/supabase-sync.js';
import type {
  InteractionEvent,
  InteractionIntent,
  MindPackage,
  MindState,
} from './types.js';
import { logger } from './logger.js';

/**
 * Record an inbound interaction event.
 * Intent is now always 'task' (classification removed — the Claude agent handles
 * persona/memory evolation naturally through conversation).
 */
export async function recordUserInteraction(
  event: Omit<InteractionEvent, 'id' | 'intent'>,
): Promise<{
  intent: InteractionIntent;
  state: MindState;
}> {
  const intent: InteractionIntent = 'task';

  const fullEvent: InteractionEvent = {
    ...event,
    id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    intent,
  };

  storeInteractionEvent(fullEvent);
  logger.debug({ eventContent: event.content?.slice(0, 80) }, 'Interaction recorded');

  const state = getMindState();
  return { intent, state };
}

export function lockMind(): MindState {
  const state = updateMindState({ lifecycle: 'locked' });
  scheduleSupabasePush();
  return state;
}

export function unlockMind(): MindState {
  const state = updateMindState({ lifecycle: 'draft' });
  scheduleSupabasePush();
  return state;
}

export function setMindPersonaPatch(
  patch: Partial<MindState['persona']>,
): MindState {
  const state = getMindState();
  if (state.lifecycle === 'locked') return state;
  const next = updateMindState({
    persona: {
      ...state.persona,
      ...patch,
    },
  });
  syncMindStateToFiles();
  scheduleSupabasePush();
  return next;
}

export function diffMindVersions(
  fromVersion: number,
  toVersion: number,
): string {
  const pkgs = listMindPackages(200);
  const from = pkgs.find((p) => p.version === fromVersion);
  const to = pkgs.find((p) => p.version === toVersion);
  if (!from || !to) return 'version not found';

  const changes: string[] = [];
  const keys = new Set([
    ...Object.keys(from.persona || {}),
    ...Object.keys(to.persona || {}),
  ]);
  for (const key of keys) {
    const a = (from.persona as any)?.[key];
    const b = (to.persona as any)?.[key];
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      changes.push(`${key}: ${JSON.stringify(a)} -> ${JSON.stringify(b)}`);
    }
  }

  if (from.memory_summary !== to.memory_summary) {
    changes.push('memory_summary changed');
  }

  return changes.length ? changes.join('\n') : 'no diff';
}

export function mindStatus(): MindState {
  return getMindState();
}

export function createPackage(
  changelog = 'Manual package create',
): MindPackage {
  const state = getMindState();
  const next = updateMindState({ version: state.version + 1 });
  const pkg = createMindPackage(
    changelog || `Package from mind v${next.version}`,
  );
  scheduleSupabasePush();
  return pkg;
}

export function listPackages(limit = 10): MindPackage[] {
  return listMindPackages(limit);
}

export function rollbackPackage(version: number): MindState | null {
  const result = rollbackMindPackage(version);
  if (result) syncMindStateToFiles();
  return result;
}
