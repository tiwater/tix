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

import { z } from 'zod';
import { generateObject } from 'ai';
import { getModelName, getOpenRouter } from './llm.js';
import { logger } from './logger.js';

const IntentSchema = z.object({
  intent: z.enum(['task', 'persona', 'memory', 'mixed', 'unknown']),
  confidence: z.number().min(0).max(1),
  persona_patch: z.object({
    tone: z.enum(['neutral', 'friendly', 'playful', 'professional']).optional(),
    verbosity: z.enum(['short', 'normal', 'detailed']).optional(),
    emoji: z.boolean().optional(),
  }).optional(),
  reason: z.string()
});

export async function recordUserInteraction(
  event: Omit<InteractionEvent, 'id' | 'intent'>,
): Promise<{
  intent: InteractionIntent;
  state: MindState;
}> {
  const openrouter = getOpenRouter();
  const model = getModelName();

  let intentResult: z.infer<typeof IntentSchema>;

  try {
    const { object } = await generateObject({
      model: openrouter(model),
      schema: IntentSchema,
      prompt: `Analyze the following user utterance and determine the intent for configuring the robot mind.\n\nUtterance: "${event.content}"\n\n- "persona": if the user is asking to change the robot's tone, verbosity, or emoji usage.\n- "memory": if they are telling the robot to remember something.\n- "mixed": if they are mixing multiple configuration instructions.\n- "task": if it's a general question, command, or execution task.\n- "unknown": if unclear.\nDetermine confidence from 0.0 to 1.0. If the intent is persona or mixed, supply the persona_patch.`
    });
    intentResult = object;
  } catch (err) {
    logger.error({ err }, 'Failed to classify intent structurally');
    intentResult = { intent: 'unknown', confidence: 0, reason: 'LLM error' };
  }

  const generatedIntent = intentResult.intent as InteractionIntent;
  logger.info({ intentResult, eventContent: event.content }, 'Intent parsed');

  const fullEvent: InteractionEvent = {
    ...event,
    id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    intent: generatedIntent,
  };

  storeInteractionEvent(fullEvent);

  let state = getMindState();
  const isAdmin = !!event.is_admin;

  if (state.lifecycle === 'locked') {
    const allowAdminOverride = MIND_LOCK_MODE === 'admin_override' && isAdmin;
    if (!allowAdminOverride) {
      return { intent: generatedIntent, state };
    }
  }

  if ((generatedIntent === 'persona' || generatedIntent === 'mixed') && intentResult.confidence >= 0.7 && intentResult.persona_patch) {
    const nextPersona = { ...state.persona, ...intentResult.persona_patch };
    state = updateMindState({
      persona: nextPersona,
      memory_summary: state.memory_summary,
    });
    syncMindStateToFiles();
    scheduleSupabasePush();
  }

  return { intent: generatedIntent, state };
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
