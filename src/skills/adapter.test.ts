import { describe, expect, it } from 'vitest';
import { adaptOpenClawSkill } from './adapter.js';
import type { DiscoveredSkill } from './types.js';

function discovered(overrides: Partial<DiscoveredSkill>): DiscoveredSkill {
  return {
    name: 'sample-skill',
    description: 'Sample skill',
    version: '1.0.0',
    directory: '/tmp/sample-skill',
    skillFilePath: '/tmp/sample-skill/SKILL.md',
    parsed: {
      metadata: {
        name: 'sample-skill',
        description: 'Sample skill',
        version: '1.0.0',
        requires: [],
        install: [],
        permissions: [],
      },
      title: 'Sample',
      frontmatter: {},
      sections: {},
      diagnostics: [],
      raw: '# Sample',
    },
    entrypoint: undefined,
    layout: {
      hasSkillFile: true,
      hasPackageJson: false,
      hasSrcDir: false,
      hasScriptsDir: false,
      hasTestsDir: false,
    },
    diagnostics: [],
    source: 'openclaw',
    ...overrides,
  };
}

describe('adaptOpenClawSkill', () => {
  it('defaults metadata-only skills to Level 1', () => {
    const adapted = adaptOpenClawSkill(discovered({}));
    expect(adapted.permission.level).toBe(1);
    expect(adapted.permission.mode).toBe('read-only');
  });

  it('elevates executable skills to Level 2', () => {
    const adapted = adaptOpenClawSkill(
      discovered({
        entrypoint: {
          path: '/tmp/sample-skill/index.js',
          type: 'script',
          exists: true,
        },
      }),
    );
    expect(adapted.permission.level).toBe(2);
  });

  it('honors explicit Level 3 declarations', () => {
    const adapted = adaptOpenClawSkill(
      discovered({
        parsed: {
          metadata: {
            name: 'sample-skill',
            description: 'Sample skill',
            version: '1.0.0',
            requires: [],
            install: [],
            permissions: ['level3'],
          },
          title: 'Sample',
          frontmatter: {},
          sections: {},
          diagnostics: [],
          raw: '# Sample',
        },
      }),
    );
    expect(adapted.permission.level).toBe(3);
    expect(adapted.permission.explicitApprovalRequired).toBe(true);
  });
});
