/**
 * Utility helpers for group folder management.
 * Previously in executor/group-folder.ts — moved here when executor/ was removed.
 */
import path from 'path';
import { TICLAW_HOME } from './config.js';

const VALID_FOLDER_RE = /^[A-Za-z0-9_-]{1,64}$/;

export function isValidGroupFolder(folder: string): boolean {
  return VALID_FOLDER_RE.test(folder);
}

export function resolveGroupFolderPath(folder: string): string {
  if (!isValidGroupFolder(folder)) {
    throw new Error(`Invalid group folder: ${JSON.stringify(folder)}`);
  }
  return path.join(TICLAW_HOME, 'factory', folder);
}
