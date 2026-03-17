/**
 * Built-in Tools for System Metadata Access.
 * Always available to every agent.
 */
import os from 'os';
import { TIMEZONE } from '../core/config.js';

export const systemTools = {
  /**
   * Get Current system time, date, and day of week.
   * Essential for scheduling and daily planning.
   */
  async get_current_time() {
    const now = new Date();
    return {
      iso: now.toISOString(),
      local: now.toLocaleString('en-US', { timeZone: TIMEZONE }),
      timezone: TIMEZONE,
      day_of_week: now.toLocaleDateString('en-US', { weekday: 'long' }),
      timestamp: Date.now()
    };
  },

  /**
   * Get basic system information (OS, uptime, memory occupancy).
   */
  async get_system_status() {
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedPercent = Math.round(((totalMem - freeMem) / totalMem) * 100);
    
    return {
      platform: os.platform(),
      release: os.release(),
      uptime: Math.round(os.uptime()),
      loadavg: os.loadavg(),
      memory: {
        total_gb: Math.round(totalMem / 1024 / 1024 / 1024),
        used_percent: usedPercent
      }
    };
  },

  /**
   * Get identity of the agent currently running.
   */
  async whoami(_args: any, context: { agent_id: string }) {
    return {
      agent_id: context.agent_id,
      description: `You are agent '${context.agent_id}' running inside TiClaw framework.`
    };
  }
};
