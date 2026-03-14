/**
 * Feishu Card Renderer - Generates beautiful interactive cards for Lark.
 * Used for system status, command results, and agent updates.
 */

export class FeishuCardRenderer {
  /**
   * Generates a "System Status" card with online/offline indicators.
   */
  static renderStatusCard(
    bots: Array<{ name: string; status: string; activity: string }>,
  ) {
    const elements = bots.map((bot) => {
      const isOnline = bot.status === 'online';
      return {
        tag: 'div',
        text: {
          tag: 'lark_md',
          content: `${isOnline ? '🟢' : '🔴'} **${bot.name}**\n状态: ${bot.status} | 活跃: ${bot.activity}`,
        },
        extra: {
          tag: 'button',
          text: { tag: 'plain_text', content: '重启' },
          type: 'primary',
          value: { action: 'restart_bot', appId: bot.name },
        },
      };
    });

    return {
      config: { wide_screen_mode: true },
      header: {
        template: 'blue',
        title: { tag: 'plain_text', content: 'TiClaw 控制中心' },
      },
      elements: [
        ...elements,
        { tag: 'hr' },
        {
          tag: 'note',
          elements: [
            {
              tag: 'plain_text',
              content: `汇报时间: ${new Date().toLocaleString()}`,
            },
          ],
        },
      ],
    };
  }
}
