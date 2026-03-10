import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { hashSkillDirectory } from './loader.js';
import { SkillsRegistry } from './registry.js';
import type { RegistryActionContext, SkillsConfig } from './types.js';

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ticlaw-skills-'));
  tempDirs.push(dir);
  return dir;
}

function adminContext(
  overrides: Partial<RegistryActionContext> = {},
): RegistryActionContext {
  return {
    actor: 'admin',
    isAdmin: true,
    ...overrides,
  };
}

function writeSkill(
  root: string,
  name: string,
  body: string,
  extra?: Record<string, string>,
) {
  const skillDir = path.join(root, name);
  writeSkillPackage(skillDir, body, extra);
  return skillDir;
}

function writeSkillPackage(
  skillDir: string,
  body: string,
  extra?: Record<string, string>,
): string {
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

function createGitRepoWithSkill(
  body: string,
  extra?: Record<string, string>,
): string {
  const repoDir = makeTempDir();
  writeSkillPackage(repoDir, body, extra);
  execFileSync('git', ['init'], { cwd: repoDir, stdio: 'pipe' });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], {
    cwd: repoDir,
    stdio: 'pipe',
  });
  execFileSync('git', ['config', 'user.name', 'Test User'], {
    cwd: repoDir,
    stdio: 'pipe',
  });
  execFileSync('git', ['add', '.'], { cwd: repoDir, stdio: 'pipe' });
  execFileSync('git', ['commit', '-m', 'init'], {
    cwd: repoDir,
    stdio: 'pipe',
  });
  return repoDir;
}

function createNpmSkillPackage(
  body: string,
  extra?: Record<string, string>,
): string {
  const pkgDir = makeTempDir();
  writeSkillPackage(pkgDir, body, {
    'package.json': JSON.stringify(
      {
        name: 'npm-third-party-skill',
        version: '1.0.0',
      },
      null,
      2,
    ),
    ...extra,
  });
  return pkgDir;
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
skill_api_version: 1.0.0
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
    const record = registry.installSkill('robot-status', adminContext());
    expect(record.enabled).toBe(false);
    expect(record.permissionLevel).toBe(2);

    const enabled = registry.enableSkill('robot-status', adminContext());
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
skill_api_version: 1.0.0
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
      registry.installSkill('dangerous-tool', adminContext()),
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
skill_api_version: 1.0.0
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

  it('installs a trusted third-party local skill with hash verification', () => {
    const root = makeTempDir();
    const sourceDir = writeSkill(
      makeTempDir(),
      'third-party-local',
      `---
name: third-party-local
description: Third-party local skill
skill_api_version: 1.0.0
permissions:
  - level2
entry: src/index.ts
---
# Third Party Local
`,
      {
        'src/index.ts': 'export const run = () => "ok";\n',
      },
    );

    const registry = new SkillsRegistry(configFor(root));
    const record = registry.installSkill(sourceDir, adminContext(), {
      trustSource: true,
      expectedHash: hashSkillDirectory(sourceDir),
    });

    expect(record.sourceRef.managed).toBe(true);
    expect(record.sourceRef.type).toBe('local');
    expect(record.sourceRef.trusted).toBe(true);
    expect(fs.existsSync(record.directory)).toBe(true);
  });

  it('installs a trusted third-party skill from git', () => {
    const root = makeTempDir();
    const repoDir = createGitRepoWithSkill(
      `---
name: git-skill
description: Third-party git skill
skill_api_version: 1.0.0
permissions:
  - level2
entry: index.js
---
# Git Skill
`,
      {
        'index.js': 'console.log("git");\n',
      },
    );

    const registry = new SkillsRegistry(configFor(root));
    const record = registry.installSkill(`git+${repoDir}`, adminContext(), {
      trustSource: true,
    });

    expect(record.name).toBe('git-skill');
    expect(record.sourceRef.type).toBe('git');
    expect(record.sourceRef.managed).toBe(true);
  });

  it('installs a trusted third-party skill from npm', () => {
    const root = makeTempDir();
    const packageDir = createNpmSkillPackage(
      `---
name: npm-skill
description: Third-party npm skill
skill_api_version: 1.0.0
permissions:
  - level2
entry: index.js
---
# NPM Skill
`,
      {
        'index.js': 'console.log("npm");\n',
      },
    );

    const registry = new SkillsRegistry(configFor(root));
    const record = registry.installSkill(`npm:${packageDir}`, adminContext(), {
      trustSource: true,
    });

    expect(record.name).toBe('npm-skill');
    expect(record.sourceRef.type).toBe('npm');
    expect(record.sourceRef.managed).toBe(true);
  });

  it('rejects incompatible skill_api_version values', () => {
    const root = makeTempDir();
    writeSkill(
      root,
      'future-skill',
      `---
name: future-skill
description: Needs a newer skill API
skill_api_version: 99.0.0
permissions:
  - level1
---
# Future Skill
`,
    );

    const registry = new SkillsRegistry(configFor(root));
    expect(() => registry.installSkill('future-skill', adminContext())).toThrow(
      /not compatible/i,
    );
  });

  it('preserves the current managed install when an upgrade fails', () => {
    const root = makeTempDir();
    const sourceDir = writeSkill(
      makeTempDir(),
      'upgradeable-skill',
      `---
name: upgradeable-skill
description: Upgradeable skill
version: 1.0.0
skill_api_version: 1.0.0
permissions:
  - level2
entry: index.js
---
# Upgradeable Skill
`,
      {
        'index.js': 'console.log("v1");\n',
      },
    );

    const registry = new SkillsRegistry(configFor(root));
    const installed = registry.installSkill(sourceDir, adminContext(), {
      trustSource: true,
    });
    const managedSkillFile = path.join(installed.directory, 'SKILL.md');
    const before = fs.readFileSync(managedSkillFile, 'utf-8');

    writeSkillPackage(
      sourceDir,
      `---
name: upgradeable-skill
description: Upgradeable skill
version: 2.0.0
skill_api_version: 99.0.0
permissions:
  - level2
entry: index.js
---
# Upgradeable Skill
`,
      {
        'index.js': 'console.log("v2");\n',
      },
    );

    expect(() =>
      registry.upgradeSkill('upgradeable-skill', adminContext()),
    ).toThrow(/not compatible/i);

    const after = registry.getInstalled('upgradeable-skill');
    expect(after?.version).toBe('1.0.0');
    expect(fs.readFileSync(managedSkillFile, 'utf-8')).toBe(before);
  });

  it('keeps listing installed skills when managed files disappear', () => {
    const root = makeTempDir();
    const sourceDir = writeSkill(
      makeTempDir(),
      'broken-managed-skill',
      `---
name: broken-managed-skill
description: Broken on disk later
version: 1.0.0
skill_api_version: 1.0.0
permissions:
  - level2
entry: index.js
---
# Broken Managed Skill
`,
      {
        'index.js': 'console.log("ok");\n',
      },
    );

    const registry = new SkillsRegistry(configFor(root));
    const installed = registry.installSkill(sourceDir, adminContext(), {
      trustSource: true,
    });

    fs.rmSync(installed.directory, { recursive: true, force: true });

    const inspected = registry.inspectSkill('broken-managed-skill');
    expect(inspected?.discovered).toBe(false);
    expect(
      inspected?.skill.diagnostics.some(
        (item) => item.code === 'missing_on_disk',
      ),
    ).toBe(true);
  });
});
