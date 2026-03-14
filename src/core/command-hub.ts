/**
 * Command Hub - Central registry for Slash Commands in TiClaw.
 * Handles rapid command execution without LLM latency.
 */

import { StatusInspector } from './status-inspector.js';
import { logger } from './logger.js';

export interface CommandResponse {
  type: 'text' | 'card';
  content: string;
  data?: any; // The generic card schema
}

export class CommandHub {
  private static commands = new Map<string, (args: string[]) => Promise<CommandResponse>>();

  /** Register core system commands */
  static init() {
    this.register('status', async () => {
      const statuses = StatusInspector.inspectAll();
      return {
        type: 'card',
        content: '正在查询系统运行状态...',
        data: StatusInspector.generateManagementCard(statuses)
      };
    });

    this.register('help', async () => {
      return {
        type: 'text',
        content: 'TiClaw 快捷指令说明:\n/status - 查看所有 Bot 连接状态\n/reload - 重新加载配置\n/web [url] - 快速抓取网页内容'
      };
    });
  }

  static register(name: string, handler: (args: string[]) => Promise<CommandResponse>) {
    this.commands.set(name, handler);
  }

  /**
   * Main Dispatcher: Checks if text is a slash command
   */
  static async tryExecute(text: string): Promise<CommandResponse | null> {
    const trimmed = text.trim();
    if (!trimmed.startsWith('/')) return null;

    const parts = trimmed.slice(1).split(/\s+/);
    const cmdName = parts[0].toLowerCase();
    const args = parts.slice(1);

    const handler = this.commands.get(cmdName);
    if (!handler) {
      return { type: 'text', content: `未知指令: /${cmdName}。输入 /help 查看可用指令。` };
    }

    try {
      logger.info({ cmdName, args }, 'Executing slash command');
      return await handler(args);
    } catch (err: any) {
      return { type: 'text', content: `指令执行失败: ${err.message}` };
    }
  }
}
