export declare const systemTools: {
    /**
     * Get Current system time, date, and day of week.
     * Essential for scheduling and daily planning.
     */
    get_current_time(): Promise<{
        iso: string;
        local: string;
        timezone: string;
        day_of_week: string;
        timestamp: number;
    }>;
    /**
     * Get basic system information (OS, uptime, memory occupancy).
     */
    get_system_status(): Promise<{
        platform: NodeJS.Platform;
        release: string;
        uptime: number;
        loadavg: number[];
        memory: {
            total_gb: number;
            used_percent: number;
        };
    }>;
    /**
     * Get identity of the agent currently running.
     */
    whoami(_args: any, context: {
        agent_id: string;
    }): Promise<{
        agent_id: string;
        description: string;
    }>;
};
//# sourceMappingURL=system.d.ts.map