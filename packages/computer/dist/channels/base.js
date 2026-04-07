/**
 * Base Abstract Channel for Tix.
 * Handles Multi-account management and JID-based routing.
 */
import { logger } from '../core/logger.js';
export class AbstractChannel {
    instances = new Map();
    opts;
    constructor(opts) {
        this.opts = opts;
    }
    /** Physical connection logic for all instances. */
    async connect() {
        logger.info({ channel: this.name }, `Connecting ${this.name} channel...`);
        const results = await Promise.allSettled(Array.from(this.instances.values()).map((inst) => this.connectInstance(inst)));
        // Log failures
        results.forEach((res, i) => {
            if (res.status === 'rejected') {
                logger.error({ channel: this.name, index: i, err: res.reason }, 'Instance connection failed');
            }
        });
    }
    /** Common JID Parser: {channel}:{app_id}:{chat_id} */
    parseJid(jid) {
        const parts = jid.split(':');
        return {
            channel: parts[0],
            appId: parts[1] || 'default',
            chatId: parts[2] || '',
        };
    }
    /** Implementation of Tix Channel Interface */
    async disconnect() {
        for (const [id, inst] of this.instances) {
            await this.disconnectInstance(inst);
            logger.info({ channel: this.name, appId: id }, 'Instance disconnected');
        }
        this.instances.clear();
    }
    isConnected() {
        return this.instances.size > 0;
    }
    ownsJid(jid) {
        return jid.startsWith(`${this.name}:`);
    }
    /** New: Return real-time status of all managed app instances. */
    getInstancesStatus() {
        // Basic implementation, subclasses can override for more detail.
        return Array.from(this.instances.keys()).map((id) => ({
            appId: id,
            connected: this.isConnected(), // simplified
            lastActivity: new Date().toISOString(),
        }));
    }
}
//# sourceMappingURL=base.js.map