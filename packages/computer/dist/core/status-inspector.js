/**
 * Status Inspector - Aggregates status data across all active channels.
 * Used to generate interactive management cards.
 */
import { getRegisteredChannelNames, } from '../channels/registry.js';
import { logger } from './logger.js';
export class StatusInspector {
    /**
     * Scan all channels and collect individual bot instance statuses.
     */
    static inspectAll() {
        const allStatuses = [];
        const channelNames = getRegisteredChannelNames();
        // Note: This relies on channels being already instantiated into singletons.
        // In a mature architecture, we'd pull from a live ChannelRegistry.
        // For now, let's look at what we've registered.
        logger.debug({ channelNames }, 'Inspecting channels for unified status');
        // This is a placeholder logic for scanning.
        // In Tix, we need to ensure we can access the live Channel instances.
        return allStatuses;
    }
    /**
     * Format the status data into a generic "Interactive Card" JSON.
     */
    static generateManagementCard(statuses) {
        return {
            title: `${process.env.TIX_PRODUCT_NAME ? process.env.TIX_PRODUCT_NAME.charAt(0).toUpperCase() + process.env.TIX_PRODUCT_NAME.slice(1) : 'Supen'} Computer 实时运行状态`,
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
//# sourceMappingURL=status-inspector.js.map