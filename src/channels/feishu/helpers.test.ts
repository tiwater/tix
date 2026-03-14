import { describe, it, expect } from 'vitest';
import { parseMessageContent, parsePostContent } from './helpers.js';

describe('Feishu Helpers', () => {
  it('should parse simple text messages', () => {
    const json = JSON.stringify({ text: 'Hello World' });
    expect(parseMessageContent(json, 'text')).toBe('Hello World');
  });

  it('should parse rich text (Post) messages into Markdown', () => {
    const postPayload = {
      title: 'Title',
      content: [
        [
          { tag: 'text', text: 'Normal text ' },
          { tag: 'text', text: 'Bold text', style: { bold: true } },
        ],
        [{ tag: 'a', text: 'Link', href: 'https://example.com' }],
      ],
    };
    const content = JSON.stringify({ post: { zh_cn: postPayload } });
    const result = parsePostContent(content);

    expect(result.textContent).toContain('Title');
    expect(result.textContent).toContain('**Bold text**');
    expect(result.textContent).toContain('[Link](https://example.com)');
  });

  it('should extract mentioned open_ids from post content', () => {
    const postWithAt = {
      content: [[{ tag: 'at', open_id: 'ou_123', user_name: 'Alice' }]],
    };
    const content = JSON.stringify(postWithAt);
    const result = parsePostContent(content);
    expect(result.mentionedOpenIds).toContain('ou_123');
    expect(result.textContent).toBe('@Alice');
  });
});
