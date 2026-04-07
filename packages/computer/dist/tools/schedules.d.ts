import { ToolContext } from './types.js';
export declare const scheduleTools: {
    /**
     * Create a recurring or one-time task schedule for the current agent.
     * Note: agent_id is automatically assigned from the execution context.
     */
    create_schedule(ctx: ToolContext, args: {
        prompt: string;
        cron: string;
    }): Promise<{
        ok: boolean;
        message: string;
        schedule_id: string;
        agent_id: string;
        cron: string;
    }>;
    /**
     * List all your active schedules.
     */
    list_my_schedules(ctx: ToolContext): Promise<{
        count: number;
        agent_id: string;
        items: {
            id: string;
            cron: string;
            prompt: string;
            status: "active" | "paused";
            next_run: string;
        }[];
    }>;
    /**
     * Remove a schedule.
     */
    delete_schedule(ctx: ToolContext, args: {
        id: string;
    }): Promise<{
        ok: boolean;
        message: string;
    }>;
};
//# sourceMappingURL=schedules.d.ts.map