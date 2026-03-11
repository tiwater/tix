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
});
