import { Dispatcher } from './dispatcher.js';
import { logger } from './logger.js';
/**
 * TixApp: The central application instance.
 * Houses the global Dispatcher and manages system lifecycle.
 */
export class TixApp {
    static instance;
    dispatcher;
    initialized = false;
    constructor() {
        this.dispatcher = new Dispatcher({
            // Global broadcast mechanism to be hooked by channels
            broadcastToChat: (chatJid, event) => {
                // This will be populated by active channel listeners
                this.emit('broadcast', { chatJid, event });
            },
            sendMessage: async (jid, text) => {
                // This will be handled by the channel that owns the JID
                this.emit('send', { jid, text });
            },
        });
    }
    static getInstance() {
        if (!TixApp.instance) {
            TixApp.instance = new TixApp();
        }
        return TixApp.instance;
    }
    // Simple event emitter pattern for cross-layer communication
    listeners = {};
    on(event, fn) {
        if (!this.listeners[event])
            this.listeners[event] = [];
        this.listeners[event].push(fn);
    }
    emit(event, data) {
        this.listeners[event]?.forEach((fn) => fn(data));
    }
    async init() {
        if (this.initialized)
            return;
        logger.info('TixApp: Initializing global core');
        // Database and other core init logic goes here
        this.initialized = true;
    }
}
export const app = TixApp.getInstance();
//# sourceMappingURL=app.js.map