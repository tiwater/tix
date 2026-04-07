import { CronExpressionParser } from 'cron-parser';
import { randomUUID } from 'crypto';
import { getAgent, getDueSchedules, getScheduleById, updateSchedule, updateScheduleAfterRun, deleteSchedule, ensureSession, } from './core/store.js';
import { logger } from './core/logger.js';
import { SCHEDULER_POLL_INTERVAL, TIMEZONE } from './core/config.js';
let schedulerRunning = false;
let timeoutId = null;
let loopRef = null;
let forcedRunPending = false;
export function forceSchedulerCheck() {
    logger.info('Manually triggering scheduler check');
    forcedRunPending = true;
    if (timeoutId)
        clearTimeout(timeoutId);
    if (loopRef)
        void loopRef();
}
export function startSchedulerLoop(_deps) {
    if (schedulerRunning) {
        logger.debug('Scheduler loop already running, skipping duplicate start');
        return;
    }
    schedulerRunning = true;
    logger.info('Scheduler loop started');
    loopRef = async () => {
        try {
            const isForced = forcedRunPending;
            forcedRunPending = false;
            const dueSchedules = getDueSchedules(isForced);
            if (dueSchedules.length > 0) {
                logger.info({ count: dueSchedules.length }, 'Found due schedules');
            }
            for (const schedule of dueSchedules) {
                if (!schedule.agent_id) {
                    logger.warn({ schedule_id: schedule.id }, 'Schedule missing agent_id, skipping');
                    continue;
                }
                const current = getScheduleById(schedule.id);
                if (!current || current.status !== 'active')
                    continue;
                if (!current.agent_id) {
                    logger.warn({ schedule_id: current.id }, 'Schedule missing agent_id, skipping');
                    continue;
                }
                const agent = getAgent(current.agent_id);
                if (!agent) {
                    logger.error({ agent_id: current.agent_id, schedule_id: current.id }, 'Schedule agent not found, pausing');
                    updateSchedule(current.id, { status: 'paused', next_run: null });
                    continue;
                }
                // Submit the task via Dispatcher so it is persisted and tracked
                // If target_jid is defined (e.g., created via Feishu/Discord channel), route to it.
                // Otherwise use the `web:` prefix so it flows through the HTTP/Web channel pipeline.
                let baseJid = current.target_jid;
                if (!baseJid) {
                    baseJid = `web:${current.agent_id}`;
                }
                const isIsolated = current.session === 'isolated';
                const chatJid = isIsolated
                    ? `${baseJid}:sched-${current.id}`
                    : baseJid;
                const taskId = `schedule-${current.id}-${Date.now()}`;
                let session_id = current.agent_id;
                if (isIsolated) {
                    session_id = `sched-${current.id}`;
                }
                else if (current.target_jid) {
                    const parts = current.target_jid.split(':');
                    session_id = parts.length > 2 ? parts[2] : parts[parts.length - 1];
                }
                const msg = {
                    id: randomUUID(),
                    chat_jid: chatJid,
                    sender: 'system',
                    sender_name: 'Scheduler',
                    content: current.prompt,
                    timestamp: new Date().toISOString(),
                    is_from_me: false, // from the user's perspective, it's an inbound command
                    agent_id: current.agent_id,
                    session_id,
                    task_id: taskId,
                };
                ensureSession({
                    agent_id: current.agent_id,
                    session_id,
                    channel: current.target_jid ? current.target_jid.split(':')[0] : 'web',
                    source_ref: chatJid,
                });
                logger.info({ schedule_id: current.id, chat_jid: msg.chat_jid, prompt: msg.content, isolated: isIsolated }, 'Queueing scheduled task via Dispatcher');
                _deps.enqueueMessage(chatJid, msg);
                // Compute next run time or delete
                if (current.delete_after_run) {
                    logger.info({ schedule_id: current.id }, 'Deleting one-shot schedule after run');
                    deleteSchedule(current.id);
                }
                else {
                    let nextRun = null;
                    try {
                        const interval = CronExpressionParser.parse(current.cron, {
                            tz: TIMEZONE,
                        });
                        nextRun = interval.next().toISOString();
                    }
                    catch (err) {
                        logger.error({ schedule_id: current.id, cron: current.cron, err }, 'Invalid cron expression, pausing schedule');
                    }
                    updateScheduleAfterRun(current.id, nextRun);
                }
            }
        }
        catch (err) {
            logger.error({ err }, 'Error in scheduler loop');
        }
        timeoutId = setTimeout(loopRef, SCHEDULER_POLL_INTERVAL);
    };
    void loopRef();
}
export function _resetSchedulerLoopForTests() {
    schedulerRunning = false;
    if (timeoutId)
        clearTimeout(timeoutId);
    timeoutId = null;
    loopRef = null;
}
//# sourceMappingURL=task-scheduler.js.map