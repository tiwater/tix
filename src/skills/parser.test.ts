import { describe, expect, it } from 'vitest';
import { parseOpenClawSkillMarkdown } from './parser.js';

describe('parseOpenClawSkillMarkdown', () => {
  it('extracts frontmatter and section metadata', () => {
    const parsed = parseOpenClawSkillMarkdown(`---
name: robot-status
description: Reads robot state
requires:
  - robot-mcp
install:
  - pnpm install
permissions:
  - level2
entry: src/index.ts
---
# Robot Status

## Requires
- robot-mcp

## Install
\`\`\`sh
pnpm build
\`\`\`
`);

    expect(parsed.metadata.name).toBe('robot-status');
    expect(parsed.metadata.description).toBe('Reads robot state');
    expect(parsed.metadata.requires).toContain('robot-mcp');
    expect(parsed.metadata.install).toContain('pnpm install');
    expect(parsed.metadata.install).toContain('pnpm build');
    expect(parsed.metadata.permissions).toContain('level2');
    expect(parsed.metadata.entry).toBe('src/index.ts');
  });
});
