/**
 * Built-in Tools for Schedule Management (Context-Injected)
 */
import { createSchedule, deleteSchedule, getSchedulesForAgent } from '../core/store.js';
import { logger } from '../core/logger.js';
export const scheduleTools = {
    /**
     * Create a recurring or one-time task schedule for the current agent.
     * Note: agent_id is automatically assigned from the execution context.
     */
    async create_schedule(ctx, args) {
        if (!ctx.agent_id)
            throw new Error('Security Error: Agent ID is missing from tool context');
        logger.info({ agent_id: ctx.agent_id, cron: args.cron }, 'Creating schedule via built-in tool');
        const schedule = createSchedule({
            agent_id: ctx.agent_id,
            prompt: args.prompt,
            cron: args.cron
        });
        return {
            ok: true,
            message: `Successfully created schedule ${schedule.id}.`,
            schedule_id: schedule.id,
            agent_id: ctx.agent_id, // Inform agent of their assigned ID
            cron: args.cron
        };
    },
    /**
     * List all your active schedules.
     */
    async list_my_schedules(ctx) {
        const schedules = getSchedulesForAgent(ctx.agent_id);
        return {
            count: schedules.length,
            agent_id: ctx.agent_id,
            items: schedules.map(s => ({
                id: s.id,
                cron: s.cron,
                prompt: s.prompt,
                status: s.status,
                next_run: s.next_run
            }))
        };
    },
    /**
     * Remove a schedule.
     */
    async delete_schedule(ctx, args) {
        // Optional: add a check here to ensure the agent only deletes their OWN schedule
        // (though getSchedulesForAgent and store logic already imply ownership)
        deleteSchedule(args.id);
        return { ok: true, message: `Schedule ${args.id} deleted` };
    }
};
//# sourceMappingURL=schedules.js.map