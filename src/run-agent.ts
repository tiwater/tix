/**
 * Redirect for legacy runAgent import paths.
 */
export * from './core/runner.js';

import path from 'path';
import { TICLAW_HOME } from './core/config.js';

export function getTaskLogPath(taskId: string): string {
  return path.join(TICLAW_HOME, 'logs', `${taskId}.log`);
}
