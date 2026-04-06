/**
 * Tix Ultimate Feishu Card Renderer
 * Designed to provide better-than-OpenTix visual experience.
 */

export class UltimateFeishuRenderer {
  /**
   * Status Card with Dashboard look
   */
  static renderDashboard(bots: any[]) {
    return {
      config: { wide_screen_mode: true },
      header: {
        template: 'purple', // Premium look
        title: { tag: 'plain_text', content: 'Tix 核心运行控制台' },
      },
      elements: [
        {
          tag: 'column_set',
          flex_mode: 'bisect',
          background_style: 'grey',
          columns: bots.map((bot) => ({
            tag: 'column',
            width: 'weighted',
            weight: 1,
            elements: [
              {
                tag: 'div',
                text: {
                  tag: 'lark_md',
                  content: `${bot.connected ? '🟢' : '🔴'} **${bot.name}**\n<font color='grey'>最后活跃: ${bot.activity}</font>`,
                },
              },
              {
                tag: 'action',
                actions: [
                  {
                    tag: 'button',
                    text: { tag: 'plain_text', content: '详情' },
                    type: 'default',
                    value: { action: 'show_details', id: bot.name },
                  },
                  {
                    tag: 'button',
                    text: { tag: 'plain_text', content: '重启' },
                    type: 'primary',
                    confirm: {
                      title: { tag: 'plain_text', content: '确认重启' },
                      text: {
                        tag: 'plain_text',
                        content: `确定要重启机器人 ${bot.name} 吗？`,
                      },
                    },
                    value: { action: 'restart', id: bot.name },
                  },
                ],
              },
            ],
          })),
        },
        { tag: 'hr' },
        {
          tag: 'div',
          text: {
            tag: 'lark_md',
            content: `📊 **资源占用**: CPU 12% | 内存 256MB\n🏠 **工作目录**: \`${process.cwd()}\``,
          },
        },
      ],
    };
  }
}
