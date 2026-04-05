/**
 * Status Inspector - Aggregates status data across all active channels.
 * Used to generate interactive management cards.
 */

import {
  getRegisteredChannelNames,
  getChannelFactory,
} from '../channels/registry.js';
import { AbstractChannel } from '../channels/base.js';
import { logger } from './logger.js';

export interface BotStatus {
  channel: string;
  appId: string;
  connected: boolean;
  lastActivity: string;
  label?: string;
}

export class StatusInspector {
  /**
   * Scan all channels and collect individual bot instance statuses.
   */
  static inspectAll(): BotStatus[] {
    const allStatuses: BotStatus[] = [];
    const channelNames = getRegisteredChannelNames();

    // Note: This relies on channels being already instantiated into singletons.
    // In a mature architecture, we'd pull from a live ChannelRegistry.
    // For now, let's look at what we've registered.

    logger.debug({ channelNames }, 'Inspecting channels for unified status');

    // This is a placeholder logic for scanning.
    // In TiClaw, we need to ensure we can access the live Channel instances.
    return allStatuses;
  }

  /**
   * Format the status data into a generic "Interactive Card" JSON.
   */
  static generateManagementCard(statuses: BotStatus[]) {
    return {
      title: `${process.env.TICLAW_PRODUCT_NAME ? process.env.TICLAW_PRODUCT_NAME.charAt(0).toUpperCase() + process.env.TICLAW_PRODUCT_NAME.slice(1) : 'Supen'} Runner 实时运行状态`,
      elements: statuses.map((s) => ({
        type: 'bot_row',
        channel: s.channel,
        name: s.appId,
        status: s.connected ? 'online' : 'offline',
        actions: ['restart', 'logs'],
      })),
    };
  }
}
