/**
 * Supabase sync layer for TiClaw (Phase 1: sync mode).
 * Local-first: all reads/writes stay local; Supabase is updated in the background.
 * Connectivity and latency to Supabase do not affect normal operation.
 */

import fs from 'fs';
import path from 'path';

import { createClient, SupabaseClient } from '@supabase/supabase-js';

import {
  AGENTS_DIR,
  AGENT_MEMORY_FILENAME,
  AGENT_MIND_FILES,
} from '../core/config.js';
import {
  getAllRegisteredProjects,
  getAllRouterState,
  getAllSessions,
  getMindState,
  listMindPackages,
  setRegisteredProject,
  setRouterState,
  setSession,
  syncUpsertMindPackage,
  updateMindState,
} from '../core/db.js';
import { syncMindStateToFiles } from '../core/mind-files.js';
import { readEnvFile } from '../core/env.js';
import { logger } from '../core/logger.js';
import type {
  MindPackage,
  MindState,
  RegisteredProject,
} from '../core/types.js';

const STORAGE_BUCKET = 'ticlaw';
const STORAGE_AGENTS_PREFIX = 'agents';
const STORAGE_GROUPS_PREFIX = 'groups'; // Legacy fallback for pull

let _client: SupabaseClient | null = null;

function getSupabaseClient(): SupabaseClient | null {
  if (_client) return _client;
  const config = readEnvFile(['SUPABASE_URL', 'SUPABASE_SERVICE_KEY']);
  const url = process.env.SUPABASE_URL || config.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY || config.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  _client = createClient(url, key);
  return _client;
}

/** Returns true if Supabase sync is configured AND explicitly enabled via SUPABASE_SYNC_ENABLED. */
export function isSupabaseConfigured(): boolean {
  const config = readEnvFile(['SUPABASE_SYNC_ENABLED']);
  const enabled =
    process.env.SUPABASE_SYNC_ENABLED === 'true' ||
    config.SUPABASE_SYNC_ENABLED === 'true';
  if (!enabled) return false;
  return getSupabaseClient() !== null;
}

const PUSH_DEBOUNCE_MS = 5000;
const PERIODIC_PUSH_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes — catches group file changes
let _pushTimer: ReturnType<typeof setTimeout> | null = null;
let _periodicTimer: ReturnType<typeof setInterval> | null = null;

/** Schedule a debounced push to Supabase. Safe to call frequently. */
export function scheduleSupabasePush(): void {
  if (!isSupabaseConfigured()) return;
  if (_pushTimer) clearTimeout(_pushTimer);
  _pushTimer = setTimeout(() => {
    _pushTimer = null;
    void pushToSupabase();
  }, PUSH_DEBOUNCE_MS);
}

/** Start periodic push (e.g. every 5 min) to catch group file changes. Call once at startup. */
export function startPeriodicSupabasePush(): void {
  if (!isSupabaseConfigured()) return;
  if (_periodicTimer) return;
  _periodicTimer = setInterval(
    () => void pushToSupabase(),
    PERIODIC_PUSH_INTERVAL_MS,
  );
  logger.debug('Supabase periodic push started');
}

/** Push local state to Supabase. Runs in background; never throws to caller. */
export async function pushToSupabase(): Promise<void> {
  const supabase = getSupabaseClient();
  if (!supabase) return;

  try {
    // 1. Mind state
    const mindState = getMindState();
    await supabase.from('mind_state').upsert(
      {
        id: mindState.id,
        version: mindState.version,
        lifecycle: mindState.lifecycle,
        persona_json: JSON.stringify(mindState.persona),
        memory_summary: mindState.memory_summary,
        updated_at: mindState.updated_at,
      },
      { onConflict: 'id' },
    );

    // 2. Mind packages
    const packages = listMindPackages(100);
    if (packages.length > 0) {
      await supabase.from('mind_packages').upsert(
        packages.map((p) => ({
          id: p.id,
          version: p.version,
          lifecycle: p.lifecycle,
          persona_json: JSON.stringify(p.persona),
          memory_summary: p.memory_summary,
          changelog: p.changelog,
          created_at: p.created_at,
        })),
        { onConflict: 'id' },
      );
    }

    // 3. Sessions
    const sessions = getAllSessions();
    const sessionRows = Object.entries(sessions).map(
      ([agent_folder, session_id]) => ({
        agent_folder,
        session_id,
      }),
    );
    if (sessionRows.length > 0) {
      await supabase
        .from('sessions')
        .upsert(sessionRows, { onConflict: 'agent_folder' });
    }

    // 4. Registered groups
    const groups = getAllRegisteredProjects();
    const groupRows = Object.entries(groups).map(([jid, g]) => ({
      jid,
      name: g.name,
      folder: g.folder,
      trigger_pattern: g.trigger,
      added_at: g.added_at,
      requires_trigger:
        g.requiresTrigger === undefined ? 1 : g.requiresTrigger ? 1 : 0,
      is_main: g.isMain ? 1 : 0,
    }));
    if (groupRows.length > 0) {
      await supabase
        .from('registered_agents')
        .upsert(groupRows, { onConflict: 'jid' });
    }

    // 5. Router state
    const routerState = getAllRouterState();
    const routerRows = Object.entries(routerState).map(([key, value]) => ({
      key,
      value,
    }));
    if (routerRows.length > 0) {
      await supabase
        .from('router_state')
        .upsert(routerRows, { onConflict: 'key' });
    }

    // 6. Agent mind files (SOUL, MEMORY, etc. — OpenClaw-compatible)
    await pushAgentFiles(supabase);

    logger.debug('Supabase push completed');
  } catch (err) {
    logger.warn({ err }, 'Supabase push failed (non-blocking)');
  }
}

function readAgentMindFile(dir: string, filename: string): string | null {
  const p = path.join(dir, filename);
  if (fs.existsSync(p)) return fs.readFileSync(p, 'utf-8');
  // Migration: MEMORY legacy CLAUDE.md
  if (filename === AGENT_MEMORY_FILENAME) {
    const legacy = path.join(dir, 'CLAUDE.md');
    if (fs.existsSync(legacy)) return fs.readFileSync(legacy, 'utf-8');
  }
  return null;
}

async function pushAgentFiles(supabase: SupabaseClient): Promise<void> {
  if (!fs.existsSync(AGENTS_DIR)) return;

  const uploadFile = async (storageKey: string, content: string) => {
    await supabase.storage.from(STORAGE_BUCKET).upload(storageKey, content, {
      contentType: 'text/markdown',
      upsert: true,
    });
  };

  // Global: all OpenClaw mind files
  for (const filename of AGENT_MIND_FILES) {
    const content = readAgentMindFile(AGENTS_DIR, filename);
    if (content)
      await uploadFile(`${STORAGE_AGENTS_PREFIX}/${filename}`, content);
  }

  // Per-agent: all OpenClaw mind files
  const entries = fs.readdirSync(AGENTS_DIR, { withFileTypes: true });
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    const agentDir = path.join(AGENTS_DIR, ent.name);
    for (const filename of AGENT_MIND_FILES) {
      const content = readAgentMindFile(agentDir, filename);
      if (content)
        await uploadFile(
          `${STORAGE_AGENTS_PREFIX}/${ent.name}/${filename}`,
          content,
        );
    }
  }
}

/** Pull from Supabase into local SQLite and files. Best-effort: if Supabase is unreachable, robot runs from last local copy. */
export async function pullFromSupabase(): Promise<void> {
  const supabase = getSupabaseClient();
  if (!supabase) return;

  try {
    // 1. Mind state (cloud wins)
    const { data: mindRows } = await supabase.from('mind_state').select('*');
    if (mindRows && mindRows.length > 0) {
      const row = mindRows[0];
      updateMindState({
        version: row.version,
        lifecycle: row.lifecycle,
        persona: JSON.parse(row.persona_json || '{}'),
        memory_summary: row.memory_summary || '',
      });
      syncMindStateToFiles();
    }

    // 2. Mind packages
    const { data: pkgRows } = await supabase
      .from('mind_packages')
      .select('*')
      .order('version', { ascending: false })
      .limit(100);
    if (pkgRows && pkgRows.length > 0) {
      for (const row of pkgRows) {
        const pkg: MindPackage = {
          id: row.id,
          version: row.version,
          lifecycle: row.lifecycle,
          persona: JSON.parse(row.persona_json || '{}'),
          memory_summary: row.memory_summary,
          changelog: row.changelog,
          created_at: row.created_at,
        };
        syncUpsertMindPackage(pkg);
      }
    }

    // 3. Sessions
    const { data: sessionRows } = await supabase.from('sessions').select('*');
    if (sessionRows) {
      for (const row of sessionRows) {
        setSession(row.agent_folder, row.session_id);
      }
    }

    // 4. Registered agents
    const { data: groupRows } = await supabase
      .from('registered_agents')
      .select('*');
    if (groupRows) {
      for (const row of groupRows) {
        const group: RegisteredProject = {
          name: row.name,
          folder: row.folder,
          trigger: row.trigger_pattern,
          added_at: row.added_at,
          requiresTrigger: row.requires_trigger === 1,
          isMain: row.is_main === 1,
        };
        try {
          setRegisteredProject(row.jid, group);
        } catch (err) {
          logger.warn(
            { jid: row.jid, err },
            'Skipping invalid registered group on pull',
          );
        }
      }
    }

    // 5. Router state
    const { data: routerRows } = await supabase
      .from('router_state')
      .select('*');
    if (routerRows) {
      for (const row of routerRows) {
        setRouterState(row.key, row.value);
      }
    }

    // 6. Agent mind files
    await pullAgentFiles(supabase);

    logger.info('Supabase pull completed');
  } catch (err) {
    logger.warn(
      { err },
      'Supabase pull failed (robot continues from local copy)',
    );
  }
}

async function pullAgentFile(
  supabase: SupabaseClient,
  storageKey: string,
  outPath: string,
): Promise<boolean> {
  const { data } = await supabase.storage
    .from(STORAGE_BUCKET)
    .download(storageKey);
  if (!data) return false;
  const content = await data.text();
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, content);
  return true;
}

async function pullAgentFiles(supabase: SupabaseClient): Promise<void> {
  fs.mkdirSync(AGENTS_DIR, { recursive: true });

  const pullWithLegacy = async (
    filename: string,
    dir: string,
    agentsPrefix: string,
    groupsPrefix: string,
  ) => {
    const outPath = path.join(dir, filename);
    const agentsKey = `${agentsPrefix}/${filename}`;
    const ok = await pullAgentFile(supabase, agentsKey, outPath);
    if (ok) return;
    const groupsKey = `${groupsPrefix}/${filename}`;
    const ok2 = await pullAgentFile(supabase, groupsKey, outPath);
    if (ok2) return;
    if (filename === AGENT_MEMORY_FILENAME) {
      (await pullAgentFile(supabase, `${agentsPrefix}/CLAUDE.md`, outPath)) ||
        (await pullAgentFile(supabase, `${groupsPrefix}/CLAUDE.md`, outPath));
    }
  };

  const projects = getAllRegisteredProjects();
  const folders = Object.values(projects).map((p) => p.folder);

  // Global: all OpenClaw mind files (try agents/ first, fall back to groups/)
  for (const filename of AGENT_MIND_FILES) {
    const outPath = path.join(AGENTS_DIR, filename);
    const ok =
      (await pullAgentFile(
        supabase,
        `${STORAGE_AGENTS_PREFIX}/${filename}`,
        outPath,
      )) ||
      (await pullAgentFile(
        supabase,
        `${STORAGE_GROUPS_PREFIX}/${filename}`,
        outPath,
      ));
    if (!ok && filename === AGENT_MEMORY_FILENAME) {
      (await pullAgentFile(
        supabase,
        `${STORAGE_AGENTS_PREFIX}/CLAUDE.md`,
        outPath,
      )) ||
        (await pullAgentFile(
          supabase,
          `${STORAGE_GROUPS_PREFIX}/CLAUDE.md`,
          outPath,
        ));
    }
  }

  // Per-agent: all OpenClaw mind files
  for (const folder of folders) {
    const agentDir = path.join(AGENTS_DIR, folder);
    fs.mkdirSync(agentDir, { recursive: true });
    for (const filename of AGENT_MIND_FILES) {
      await pullWithLegacy(
        filename,
        agentDir,
        `${STORAGE_AGENTS_PREFIX}/${folder}`,
        `${STORAGE_GROUPS_PREFIX}/${folder}`,
      );
    }
  }
}
