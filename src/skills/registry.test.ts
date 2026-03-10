import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { SkillsRegistry } from './registry.js';
import type { SkillsConfig } from './types.js';

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ticlaw-skills-'));
  tempDirs.push(dir);
  return dir;
}

function writeSkill(root: string, name: string, body: string, extra?: Record<string, string>) {
  const skillDir = path.join(root, name);
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), body);
  if (extra) {
    for (const [filePath, content] of Object.entries(extra)) {
      const fullPath = path.join(skillDir, filePath);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, content);
    }
  }
  return skillDir;
}

function configFor(root: string): SkillsConfig {
  return {
    directories: [root],
    adminOnly: true,
    allowLevel3: false,
    autoEnableOnInstall: false,
    statePath: path.join(root, '.ticlaw', 'skills-state.json'),
    auditLogPath: path.join(root, '.ticlaw', 'skills-audit.jsonl'),
  };
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('SkillsRegistry', () => {
  it('installs and enables a Level 2 skill for admins', () => {
    const root = makeTempDir();
    writeSkill(
      root,
      'robot-status',
      `---
name: robot-status
description: Query robot state through robot-mcp
permissions:
  - level2
entry: src/index.ts
---
# Robot Status
`,
      {
        'src/index.ts': 'export const run = () => "ok";\n',
      },
    );

    const registry = new SkillsRegistry(configFor(root));
    const record = registry.installSkill('robot-status', {
      actor: 'admin',
      isAdmin: true,
    });
    expect(record.enabled).toBe(false);
    expect(record.permissionLevel).toBe(2);

    const enabled = registry.enableSkill('robot-status', {
      actor: 'admin',
      isAdmin: true,
    });
    expect(enabled.enabled).toBe(true);
  });

  it('rejects Level 3 installs without explicit approval', () => {
    const root = makeTempDir();
    const cfg = {
      ...configFor(root),
      allowLevel3: true,
    };
    writeSkill(
      root,
      'dangerous-tool',
      `---
name: dangerous-tool
description: touches host state
permissions:
  - level3
entry: run.sh
---
# Dangerous Tool
`,
      {
        'run.sh': '#!/bin/sh\necho hi\n',
      },
    );

    const registry = new SkillsRegistry(cfg);
    expect(() =>
      registry.installSkill('dangerous-tool', {
        actor: 'admin',
        isAdmin: true,
      }),
    ).toThrow(/explicit approval/i);
  });

  it('rejects non-admin Level 2 installs', () => {
    const root = makeTempDir();
    writeSkill(
      root,
      'sandbox-tool',
      `---
name: sandbox-tool
description: sandboxed executor
permissions:
  - level2
entry: index.js
---
# Sandbox Tool
`,
      {
        'index.js': 'console.log("hello");\n',
      },
    );

    const registry = new SkillsRegistry(configFor(root));
    expect(() =>
      registry.installSkill('sandbox-tool', {
        actor: 'user',
        isAdmin: false,
      }),
    ).toThrow(/admin/i);
  });
});
