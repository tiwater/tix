/**
 * Status Inspector - Aggregates status data across all active channels.
 * Used to generate interactive management cards.
 */
export interface BotStatus {
    channel: string;
    appId: string;
    connected: boolean;
    lastActivity: string;
    label?: string;
}
export declare class StatusInspector {
    /**
     * Scan all channels and collect individual bot instance statuses.
     */
    static inspectAll(): BotStatus[];
    /**
     * Format the status data into a generic "Interactive Card" JSON.
     */
    static generateManagementCard(statuses: BotStatus[]): {
        title: string;
        elements: {
            type: string;
            channel: string;
            name: string;
            status: string;
            actions: string[];
        }[];
    };
}
//# sourceMappingURL=status-inspector.d.ts.map