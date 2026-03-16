import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { SKILLS_CONFIG } from '../core/config.js';
import { executeSkillsCommand } from './commands.js';

const tempDirs: string[] = [];
const originalConfig = {
  directories: [...SKILLS_CONFIG.directories],
  adminOnly: SKILLS_CONFIG.adminOnly,
  allowLevel3: SKILLS_CONFIG.allowLevel3,
  autoEnableOnInstall: SKILLS_CONFIG.autoEnableOnInstall,
  statePath: SKILLS_CONFIG.statePath,
  auditLogPath: SKILLS_CONFIG.auditLogPath,
};

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ticlaw-skills-cmd-'));
  tempDirs.push(dir);
  return dir;
}

function writeSkillPackage(
  skillDir: string,
  body: string,
  extra?: Record<string, string>,
): void {
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), body);
  for (const [filePath, content] of Object.entries(extra || {})) {
    const fullPath = path.join(skillDir, filePath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content);
  }
}

afterEach(() => {
  SKILLS_CONFIG.directories = [...originalConfig.directories];
  SKILLS_CONFIG.adminOnly = originalConfig.adminOnly;
  SKILLS_CONFIG.allowLevel3 = originalConfig.allowLevel3;
  SKILLS_CONFIG.autoEnableOnInstall = originalConfig.autoEnableOnInstall;
  SKILLS_CONFIG.statePath = originalConfig.statePath;
  SKILLS_CONFIG.auditLogPath = originalConfig.auditLogPath;

  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('executeSkillsCommand', () => {
  it('shows audit events via /skills audit', () => {
    const workspace = makeTempDir();
    const discoveryRoot = path.join(workspace, 'skills');
    const sourceDir = path.join(makeTempDir(), 'audit-skill');
    writeSkillPackage(
      sourceDir,
      `---
name: audit-skill
description: audit coverage skill
version: 1.0.0
skill_api_version: 1.0.0
permissions:
  - level2
entry: index.js
---
# Audit Skill
`,
      {
        'index.js': 'console.log("audit");\n',
      },
    );

    SKILLS_CONFIG.directories = [discoveryRoot];
    SKILLS_CONFIG.adminOnly = true;
    SKILLS_CONFIG.allowLevel3 = false;
    SKILLS_CONFIG.autoEnableOnInstall = false;
    SKILLS_CONFIG.statePath = path.join(
      workspace,
      '.ticlaw',
      'skills-state.json',
    );
    SKILLS_CONFIG.auditLogPath = path.join(
      workspace,
      '.ticlaw',
      'skills-audit.jsonl',
    );

    const installed = executeSkillsCommand(['install', sourceDir, '--trust'], {
      actor: 'admin',
      isAdmin: true,
    });
    expect(installed.ok).toBe(true);

    const audit = executeSkillsCommand(['audit', '--limit', '5'], {
      actor: 'admin',
      isAdmin: true,
    });
    expect(audit.ok).toBe(true);
    expect(audit.message).toContain('Recent skills audit events');
    expect(audit.message).toContain('install audit-skill@1.0.0');

    const auditJson = executeSkillsCommand(['audit', '--json'], {
      actor: 'admin',
      isAdmin: true,
    });
    expect(auditJson.ok).toBe(true);
    const parsedAudit = JSON.parse(auditJson.message) as Array<{
      action: string;
      skill: string;
    }>;
    expect(parsedAudit[0]).toMatchObject({
      action: 'install',
      skill: 'audit-skill',
    });
  });

  it('emits list --json with managed third-party skill metadata', () => {
    const workspace = makeTempDir();
    const discoveryRoot = path.join(workspace, 'skills');
    const sourceDir = path.join(makeTempDir(), 'third-party-json');
    writeSkillPackage(
      sourceDir,
      `---
name: third-party-json
description: JSON test skill
version: 1.0.0
skill_api_version: 1.0.0
permissions:
  - level2
entry: index.js
---
# Third Party JSON
`,
      {
        'index.js': 'console.log("json");\n',
      },
    );

    SKILLS_CONFIG.directories = [discoveryRoot];
    SKILLS_CONFIG.adminOnly = true;
    SKILLS_CONFIG.allowLevel3 = false;
    SKILLS_CONFIG.autoEnableOnInstall = false;
    SKILLS_CONFIG.statePath = path.join(
      workspace,
      '.ticlaw',
      'skills-state.json',
    );
    SKILLS_CONFIG.auditLogPath = path.join(
      workspace,
      '.ticlaw',
      'skills-audit.jsonl',
    );

    const installed = executeSkillsCommand(['install', sourceDir, '--trust'], {
      actor: 'admin',
      isAdmin: true,
    });
    expect(installed.ok).toBe(true);

    const listed = executeSkillsCommand(['list', '--json'], {
      actor: 'admin',
      isAdmin: true,
    });
    expect(listed.ok).toBe(true);

    const parsed = JSON.parse(listed.message) as Array<{
      name: string;
      managed: boolean;
      source_type: string;
      status: string;
    }>;
    expect(parsed).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'third-party-json',
          managed: true,
          source_type: 'local',
          status: 'installed/disabled',
        }),
      ]),
    );
  });

  it('reports auth status for all skills as json', () => {
    const workspace = makeTempDir();
    const discoveryRoot = path.join(workspace, 'skills');

    writeSkillPackage(
      path.join(discoveryRoot, 'auth-ok'),
      `---
name: auth-ok
description: authenticated skill
version: 1.0.0
skill_api_version: 1.0.0
permissions:
  - execute
entry: index.js
---
# Auth OK
`,
      {
        'index.js': 'console.log("auth-ok");\n',
        'scripts/auth-status.sh': 'echo "authenticated"\n',
      },
    );

    writeSkillPackage(
      path.join(discoveryRoot, 'auth-missing'),
      `---
name: auth-missing
description: unauthenticated skill
version: 1.0.0
skill_api_version: 1.0.0
permissions:
  - execute
entry: index.js
---
# Auth Missing
`,
      {
        'index.js': 'console.log("auth-missing");\n',
        'scripts/auth-status.sh': 'echo "not logged in" >&2\nexit 10\n',
      },
    );

    writeSkillPackage(
      path.join(discoveryRoot, 'auth-unsupported'),
      `---
name: auth-unsupported
description: no auth script
version: 1.0.0
skill_api_version: 1.0.0
permissions:
  - execute
entry: index.js
---
# Auth Unsupported
`,
      {
        'index.js': 'console.log("auth-unsupported");\n',
      },
    );

    SKILLS_CONFIG.directories = [discoveryRoot];
    SKILLS_CONFIG.adminOnly = true;
    SKILLS_CONFIG.allowLevel3 = false;
    SKILLS_CONFIG.autoEnableOnInstall = false;
    SKILLS_CONFIG.statePath = path.join(
      workspace,
      '.ticlaw',
      'skills-state.json',
    );
    SKILLS_CONFIG.auditLogPath = path.join(
      workspace,
      '.ticlaw',
      'skills-audit.jsonl',
    );

    const result = executeSkillsCommand(['auth', 'status', '--json'], {
      actor: 'admin',
      isAdmin: true,
    });

    expect(result.ok).toBe(true);
    const parsed = JSON.parse(result.message) as Array<{
      skill: string;
      state: string;
      authenticated: boolean | null;
    }>;

    expect(parsed).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          skill: 'auth-ok',
          state: 'authenticated',
          authenticated: true,
        }),
        expect.objectContaining({
          skill: 'auth-missing',
          state: 'unauthenticated',
          authenticated: false,
        }),
        expect.objectContaining({
          skill: 'auth-unsupported',
          state: 'unsupported',
          authenticated: null,
        }),
      ]),
    );
  });

  it('runs skill auth login script', () => {
    const workspace = makeTempDir();
    const discoveryRoot = path.join(workspace, 'skills');

    writeSkillPackage(
      path.join(discoveryRoot, 'auth-login'),
      `---
name: auth-login
description: auth login skill
version: 1.0.0
skill_api_version: 1.0.0
permissions:
  - execute
entry: index.js
---
# Auth Login
`,
      {
        'index.js': 'console.log("auth-login");\n',
        'scripts/auth-login.sh': 'echo "login ok"\n',
      },
    );

    SKILLS_CONFIG.directories = [discoveryRoot];
    SKILLS_CONFIG.adminOnly = true;
    SKILLS_CONFIG.allowLevel3 = false;
    SKILLS_CONFIG.autoEnableOnInstall = false;
    SKILLS_CONFIG.statePath = path.join(
      workspace,
      '.ticlaw',
      'skills-state.json',
    );
    SKILLS_CONFIG.auditLogPath = path.join(
      workspace,
      '.ticlaw',
      'skills-audit.jsonl',
    );

    const result = executeSkillsCommand(['auth', 'login', 'auth-login'], {
      actor: 'admin',
      isAdmin: true,
    });

    expect(result.ok).toBe(true);
    expect(result.message).toContain('Authenticated skill "auth-login".');
  });
});
