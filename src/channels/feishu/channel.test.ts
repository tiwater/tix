import { describe, it, expect, vi } from 'vitest';
import { FeishuChannel } from './channel.js';
import { ChannelOpts } from '../../core/types.js';

describe('FeishuChannel Integration', () => {
  it('should dispatch received messages with correct JID format', async () => {
    const onMessage = vi.fn();
    const opts: ChannelOpts = {
      onMessage,
      onChatMetadata: vi.fn(),
      registeredProjects: () => ({}),
    };

    const accounts = [{ appId: 'cli_abc', appSecret: 'sec_123' }];
    const channel = new FeishuChannel(accounts, opts);
    
    // Manually trigger the private connection setup to get the dispatcher
    const inst = (channel as any).instances.get('cli_abc');
    const dispatcher = inst.wsClient.eventDispatcher;

    // Simulate an incoming message event from Lark SDK
    const mockEvent = {
      sender: { sender_id: { open_id: 'ou_user1' } },
      message: { 
        chat_id: 'oc_chat1',
        message_id: 'msg_999',
        content: JSON.stringify({ text: 'Find news' }),
        message_type: 'text'
      }
    };

    await dispatcher.do('im.message.receive_v1', mockEvent);

    expect(onMessage).toHaveBeenCalled();
    const [jid, msg] = onMessage.mock.calls[0];
    
    // Verify Industrial Routing JID
    expect(jid).toBe('feishu:cli_abc:oc_chat1');
    expect(msg.content).toContain('Find news');
    expect(msg.sender).toBe('ou_user1');
  });
});
