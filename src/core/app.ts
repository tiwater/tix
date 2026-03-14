import { Dispatcher } from './dispatcher.js';
import { logger } from './logger.js';

/**
 * TiClawApp: The central application instance.
 * Houses the global Dispatcher and manages system lifecycle.
 */
export class TiClawApp {
  private static instance: TiClawApp;
  public readonly dispatcher: Dispatcher;
  private initialized = false;

  private constructor() {
    this.dispatcher = new Dispatcher({
      // Global broadcast mechanism to be hooked by channels
      broadcastToChat: (chatJid: string, event: object) => {
        // This will be populated by active channel listeners
        this.emit('broadcast', { chatJid, event });
      },
      sendMessage: async (jid: string, text: string) => {
        // This will be handled by the channel that owns the JID
        this.emit('send', { jid, text });
      },
    });
  }

  public static getInstance(): TiClawApp {
    if (!TiClawApp.instance) {
      TiClawApp.instance = new TiClawApp();
    }
    return TiClawApp.instance;
  }

  // Simple event emitter pattern for cross-layer communication
  private listeners: Record<string, Function[]> = {};

  public on(event: string, fn: Function) {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(fn);
  }

  public emit(event: string, data: any) {
    this.listeners[event]?.forEach((fn) => fn(data));
  }

  public async init() {
    if (this.initialized) return;
    logger.info('TiClawApp: Initializing global core');
    // Database and other core init logic goes here
    this.initialized = true;
  }
}

export const app = TiClawApp.getInstance();
