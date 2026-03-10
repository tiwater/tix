import fs from 'fs';
import path from 'path';
import { SKILLS_CONFIG } from '../core/config.js';
import { logger } from '../core/logger.js';
import { adaptOpenClawSkill } from './adapter.js';
import { loadOpenClawSkills } from './loader.js';
import type {
  AdaptedSkill,
  ListedSkill,
  RegistryActionContext,
  SkillAuditAction,
  SkillAuditEvent,
  SkillsConfig,
  SkillsRegistryState,
} from './types.js';

function ensureParentDir(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function defaultState(): SkillsRegistryState {
  return {
    version: 1,
    installed: {},
  };
}

function registryError(message: string): never {
  throw new Error(message);
}

export class SkillsRegistry {
  private readonly config: SkillsConfig;

  constructor(config: SkillsConfig = SKILLS_CONFIG) {
    this.config = config;
  }

  getConfig(): SkillsConfig {
    return this.config;
  }

  listAvailable(): ListedSkill[] {
    const state = this.readState();
    return loadOpenClawSkills(this.config.directories)
      .map((skill) => adaptOpenClawSkill(skill))
      .map((skill) => ({
        skill,
        installed: state.installed[skill.name],
      }))
      .sort((left, right) => left.skill.name.localeCompare(right.skill.name));
  }

  getSkill(name: string): AdaptedSkill | undefined {
    return this.listAvailable().find((entry) => entry.skill.name === name)?.skill;
  }

  getInstalled(name: string) {
    return this.readState().installed[name];
  }

  installSkill(name: string, context: RegistryActionContext) {
    const skill = this.requireSkill(name);
    this.assertAllowed(skill, context, 'install');

    const state = this.readState();
    const now = new Date().toISOString();
    const existing = state.installed[skill.name];
    state.installed[skill.name] = {
      name: skill.name,
      version: skill.version,
      source: skill.source,
      directory: skill.directory,
      description: skill.description,
      enabled: existing?.enabled ?? this.config.autoEnableOnInstall,
      permissionLevel: skill.permission.level,
      installedAt: existing?.installedAt ?? now,
      updatedAt: now,
      installedBy: existing?.installedBy ?? context.actor,
      lastActionBy: context.actor,
      entrypoint: skill.entrypoint?.path,
      requires: skill.requires,
      install: skill.install,
      diagnostics: skill.diagnostics,
    };

    this.writeState(state);
    this.appendAudit('install', skill, context);
    return state.installed[skill.name];
  }

  enableSkill(name: string, context: RegistryActionContext) {
    const skill = this.requireSkill(name);
    this.assertAllowed(skill, context, 'enable');

    const state = this.readState();
    const installed = state.installed[skill.name];
    if (!installed) {
      registryError(`Skill "${name}" is not installed.`);
    }

    installed.enabled = true;
    installed.updatedAt = new Date().toISOString();
    installed.lastActionBy = context.actor;
    this.writeState(state);
    this.appendAudit('enable', skill, context);
    return installed;
  }

  disableSkill(name: string, context: RegistryActionContext) {
    const state = this.readState();
    const installed = state.installed[name];
    if (!installed) {
      registryError(`Skill "${name}" is not installed.`);
    }

    const skill = this.getSkill(name) || {
      name: installed.name,
      version: installed.version,
      source: installed.source,
      directory: installed.directory,
      description: installed.description,
      entrypoint: installed.entrypoint
        ? {
            path: installed.entrypoint,
            type: 'script',
            exists: fs.existsSync(installed.entrypoint),
          }
        : undefined,
      permission: {
        level: installed.permissionLevel,
        mode:
          installed.permissionLevel === 1
            ? 'read-only'
            : installed.permissionLevel === 2
              ? 'sandboxed-exec'
              : 'privileged-exec',
        installRequiresAdmin: installed.permissionLevel > 1,
        explicitApprovalRequired: installed.permissionLevel === 3,
        declared: [],
        reasons: ['restored from installed state'],
      },
      requires: installed.requires,
      install: installed.install,
      commands: [],
      diagnostics: installed.diagnostics,
      id: `${installed.name}@${installed.version}`,
    };

    this.assertAllowed(skill, context, 'disable');
    installed.enabled = false;
    installed.updatedAt = new Date().toISOString();
    installed.lastActionBy = context.actor;
    this.writeState(state);
    this.appendAudit('disable', skill, context);
    return installed;
  }

  inspectSkill(name: string): ListedSkill | undefined {
    return this.listAvailable().find((entry) => entry.skill.name === name);
  }

  private requireSkill(name: string): AdaptedSkill {
    const skill = this.getSkill(name);
    if (!skill) {
      registryError(
        `Skill "${name}" was not found. Checked: ${this.config.directories.join(', ')}`,
      );
    }
    return skill;
  }

  private assertAllowed(
    skill: AdaptedSkill,
    context: RegistryActionContext,
    action: SkillAuditAction,
  ): void {
    if (this.config.adminOnly && !context.isAdmin) {
      registryError(`Only admin users can ${action} skills.`);
    }

    if (skill.permission.level === 3) {
      if (!this.config.allowLevel3) {
        registryError(
          `Level 3 skills are disabled by config. Set skills.allow_level3=true to permit "${skill.name}".`,
        );
      }
      if (!context.isAdmin) {
        registryError(`Only admin users can ${action} Level 3 skills.`);
      }
      if (!context.approveLevel3) {
        registryError(
          `Level 3 skill "${skill.name}" requires explicit approval. Re-run with "--approve".`,
        );
      }
    }
  }

  private readState(): SkillsRegistryState {
    try {
      const raw = fs.readFileSync(this.config.statePath, 'utf-8');
      const parsed = JSON.parse(raw) as SkillsRegistryState;
      if (!parsed || typeof parsed !== 'object' || !parsed.installed) {
        return defaultState();
      }
      return {
        version: 1,
        installed: parsed.installed,
      };
    } catch {
      return defaultState();
    }
  }

  private writeState(state: SkillsRegistryState): void {
    ensureParentDir(this.config.statePath);
    fs.writeFileSync(this.config.statePath, JSON.stringify(state, null, 2));
  }

  private appendAudit(
    action: SkillAuditAction,
    skill: AdaptedSkill,
    context: RegistryActionContext,
  ): void {
    const event: SkillAuditEvent = {
      action,
      actor: context.actor,
      isAdmin: context.isAdmin,
      approved: !!context.approveLevel3,
      skill: skill.name,
      version: skill.version,
      permissionLevel: skill.permission.level,
      timestamp: new Date().toISOString(),
    };

    ensureParentDir(this.config.auditLogPath);
    fs.appendFileSync(this.config.auditLogPath, `${JSON.stringify(event)}\n`);
    logger.info({ event }, 'skills audit event');
  }
}
