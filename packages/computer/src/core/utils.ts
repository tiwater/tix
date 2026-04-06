/**
 * Utility helpers for group folder management.
 * Previously in executor/group-folder.ts — moved here when executor/ was removed.
 */
import fs from 'fs';
import path from 'path';
import { TIX_HOME, agentPaths } from './config.js';

const VALID_FOLDER_RE = /^[A-Za-z0-9_-]{1,64}$/;

export function isValidGroupFolder(folder: string): boolean {
  return VALID_FOLDER_RE.test(folder);
}

export function resolveGroupFolderPath(folder: string): string {
  if (!isValidGroupFolder(folder)) {
    throw new Error(`Invalid group folder: ${JSON.stringify(folder)}`);
  }
  return path.join(TIX_HOME, 'factory', folder);
}

// ── Task log helpers (moved from run-agent.ts) ──

export function getTaskLogPath(agentId: string, taskId: string): string {
  const paths = agentPaths(agentId);
  return path.join(paths.base, 'logs', `${taskId}.log`);
}

export function appendJobLog(
  agentId: string,
  taskId: string,
  line: string,
): void {
  const logPath = getTaskLogPath(agentId, taskId);
  const dir = path.dirname(logPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(logPath, `${line}\n`, 'utf-8');
}
