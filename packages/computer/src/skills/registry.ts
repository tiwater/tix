import fs from 'fs';
import path from 'path';
import { SKILLS_CONFIG } from '../core/config.js';
import { logger } from '../core/logger.js';
import { isPathWithin } from '../core/security.js';
import { adaptOpenTixSkill } from './adapter.js';
import {
  hashSkillDirectory,
  loadOpenTixSkillFromDirectory,
  loadOpenTixSkillsDetailed,
  materializeSkillSource,
  resolveSkillSourceSpec,
  writeManagedSkillManifest,
} from './loader.js';
import type {
  AdaptedSkill,
  FailedSkillLoad,
  InstalledSkillRecord,
  ListedSkill,
  RegistryActionContext,
  SkillAuditAction,
  SkillAuditEvent,
  SkillDiagnostic,
  SkillInstallOptions,
  SkillPermissionLevel,
  SkillsConfig,
  SkillsRegistryState,
  TrustedSkillSourceRecord,
} from './types.js';

function ensureParentDir(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function ensureDir(dirPath: string): void {
  fs.mkdirSync(dirPath, { recursive: true });
}

function copyDirectory(sourceDir: string, targetDir: string): void {
  fs.cpSync(sourceDir, targetDir, { recursive: true, force: true });
}

function defaultState(): SkillsRegistryState {
  return {
    version: 2,
    installed: {},
    trustedSources: {},
  };
}

function registryError(message: string): never {
  throw new Error(message);
}

function permissionModeForLevel(level: SkillPermissionLevel) {
  if (level === 1) return 'read-only';
  if (level === 2) return 'sandboxed-exec';
  return 'privileged-exec';
}

function sanitizeDirectoryName(name: string): string {
  const cleaned = name.trim().replace(/[^a-zA-Z0-9._-]+/g, '-');
  return cleaned || 'skill';
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
    const { skills, failures } = this.loadDiscoveredSkills();
    const entries = skills
      .map((skill) => ({
        skill,
        installed: state.installed[skill.name],
        discovered: true,
      }))
      .sort((left, right) => left.skill.name.localeCompare(right.skill.name));

    const seen = new Set(entries.map((entry) => entry.skill.name));
    for (const installed of Object.values(state.installed)) {
      if (seen.has(installed.name)) continue;
      const failure = failures.find(
        (entry) =>
          path.resolve(entry.directory) === path.resolve(installed.directory),
      );
      entries.push({
        skill: this.restoreInstalledSkill(installed, failure),
        installed,
        discovered: false,
      });
    }

    return entries.sort((left, right) =>
      left.skill.name.localeCompare(right.skill.name),
    );
  }

  getSkill(name: string): AdaptedSkill | undefined {
    return this.loadDiscoveredSkills().skills.find(
      (entry) => entry.name === name,
    );
  }

  getInstalled(name: string): InstalledSkillRecord | undefined {
    return this.readState().installed[name];
  }

  installSkill(
    nameOrSource: string,
    context: RegistryActionContext,
    options: SkillInstallOptions = {},
  ): InstalledSkillRecord {
    const skill = this.getSkill(nameOrSource);
    if (skill) {
      return this.persistDiscoveredSkill('install', skill, context, options);
    }
    return this.installManagedSkill(nameOrSource, context, options);
  }

  upgradeSkill(
    name: string,
    context: RegistryActionContext,
    options: SkillInstallOptions = {},
  ): InstalledSkillRecord {
    const installed = this.getInstalled(name);
    if (!installed) {
      registryError(`Skill "${name}" is not installed.`);
    }

    if (installed.sourceRef.managed) {
      return this.installManagedSkill(
        installed.sourceRef.spec,
        context,
        options,
        name,
      );
    }

    const skill = this.requireSkill(name);
    return this.persistDiscoveredSkill('upgrade', skill, context, options);
  }

  enableSkill(
    name: string,
    context: RegistryActionContext,
  ): InstalledSkillRecord {
    const skill = this.requireSkill(name);
    if (
      skill.sourceRef.managed &&
      skill.diagnostics.some((item) => item.code === 'content_hash_drift')
    ) {
      registryError(
        `Managed skill "${name}" integrity drift detected. Reinstall or upgrade before enabling.`,
      );
    }
    this.assertCompatible(skill);
    this.assertExecutableActionAllowed(skill, context, 'enable');

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

  disableSkill(
    name: string,
    context: RegistryActionContext,
  ): InstalledSkillRecord {
    this.assertManagementAllowed(context, 'disable');

    const state = this.readState();
    const installed = state.installed[name];
    if (!installed) {
      registryError(`Skill "${name}" is not installed.`);
    }

    const skill = this.getSkill(name) || this.restoreInstalledSkill(installed);
    installed.enabled = false;
    installed.updatedAt = new Date().toISOString();
    installed.lastActionBy = context.actor;
    this.writeState(state);
    this.appendAudit('disable', skill, context);
    return installed;
  }

  removeSkill(
    name: string,
    context: RegistryActionContext,
  ): InstalledSkillRecord {
    this.assertManagementAllowed(context, 'remove');

    const state = this.readState();
    const installed = state.installed[name];
    if (!installed) {
      registryError(`Skill "${name}" is not installed.`);
    }

    const skill = this.getSkill(name) || this.restoreInstalledSkill(installed);
    if (installed.sourceRef.managed) {
      const managedRoot = this.managedSkillsRoot();
      if (!isPathWithin(managedRoot, installed.directory)) {
        registryError(
          `Refusing to remove managed skill "${name}" from path outside managed root: ${installed.directory}`,
        );
      }
      fs.rmSync(installed.directory, { recursive: true, force: true });
    }

    delete state.installed[name];
    this.writeState(state);
    this.appendAudit('remove', skill, context);
    return installed;
  }

  inspectSkill(name: string): ListedSkill | undefined {
    return this.listAvailable().find((entry) => entry.skill.name === name);
  }

  private persistDiscoveredSkill(
    action: 'install' | 'upgrade',
    skill: AdaptedSkill,
    context: RegistryActionContext,
    options: SkillInstallOptions,
  ): InstalledSkillRecord {
    this.assertCompatible(skill);
    this.assertExecutableActionAllowed(skill, context, action);

    const contentHash = hashSkillDirectory(skill.directory);
    if (options.expectedHash && options.expectedHash !== contentHash) {
      registryError(
        `Skill "${skill.name}" hash mismatch. Expected ${options.expectedHash}, got ${contentHash}.`,
      );
    }

    const state = this.readState();
    const existing = state.installed[skill.name];
    const record = this.buildInstalledRecord(
      skill,
      context,
      existing,
      contentHash,
      {
        ...skill.sourceRef,
        trusted:
          skill.sourceRef.trusted ||
          !!state.trustedSources[skill.sourceRef.canonical] ||
          !!options.trustSource,
      },
    );
    state.installed[skill.name] = record;

    if (
      options.trustSource &&
      !state.trustedSources[skill.sourceRef.canonical]
    ) {
      state.trustedSources[skill.sourceRef.canonical] = this.buildTrustedSource(
        skill.sourceRef.type,
        skill.sourceRef.canonical,
        context.actor,
      );
    }

    this.writeState(state);
    this.appendAudit(action, skill, context, contentHash);
    return record;
  }

  private installManagedSkill(
    sourceSpec: string,
    context: RegistryActionContext,
    options: SkillInstallOptions,
    upgradeName?: string,
  ): InstalledSkillRecord {
    this.assertManagementAllowed(context, upgradeName ? 'upgrade' : 'install');

    const state = this.readState();
    const resolvedSource = resolveSkillSourceSpec(sourceSpec);
    const trustedSource =
      !!state.trustedSources[resolvedSource.canonical] || !!options.trustSource;

    if (!trustedSource) {
      registryError(
        `Skill source "${resolvedSource.canonical}" is not trusted. Re-run with "--trust" to whitelist it.`,
      );
    }

    const materialized = materializeSkillSource(sourceSpec, { proxy: options.proxy });
    const managedRoot = this.managedSkillsRoot();
    ensureDir(managedRoot);

    let stageDir = '';
    let backupDir = '';

    try {
      const discovered = loadOpenTixSkillFromDirectory(materialized.skillDir);
      const skill = adaptOpenTixSkill({
        ...discovered,
        sourceRef: {
          ...materialized.sourceRef,
          canonical: resolvedSource.canonical,
          trusted: trustedSource,
        },
      });

      if (upgradeName && skill.name !== upgradeName) {
        registryError(
          `Upgrading "${upgradeName}" resolved to "${skill.name}". Skill names must remain stable across upgrades.`,
        );
      }

      const conflictingSkill = this.loadDiscoveredSkills().skills.find(
        (entry) =>
          entry.name === skill.name &&
          path.resolve(entry.directory) !==
            path.resolve(
              path.join(managedRoot, sanitizeDirectoryName(skill.name)),
            ),
      );
      if (conflictingSkill && !conflictingSkill.sourceRef.managed) {
        registryError(
          `Skill name "${skill.name}" conflicts with an existing local skill at ${conflictingSkill.directory}.`,
        );
      }

      this.assertCompatible(skill);
      this.assertExecutableActionAllowed(
        skill,
        context,
        upgradeName ? 'upgrade' : 'install',
      );

      const contentHash = hashSkillDirectory(materialized.skillDir);
      if (options.expectedHash && options.expectedHash !== contentHash) {
        registryError(
          `Skill "${skill.name}" hash mismatch. Expected ${options.expectedHash}, got ${contentHash}.`,
        );
      }

      stageDir = path.join(
        managedRoot,
        `.staging-${sanitizeDirectoryName(skill.name)}-${Date.now()}`,
      );
      copyDirectory(materialized.skillDir, stageDir);
      writeManagedSkillManifest(stageDir, {
        sourceRef: {
          ...skill.sourceRef,
          managed: true,
          trusted: true,
        },
        contentHash,
        installedAt: new Date().toISOString(),
      });

      const finalDir = path.join(
        managedRoot,
        sanitizeDirectoryName(skill.name),
      );
      if (fs.existsSync(finalDir)) {
        backupDir = `${finalDir}.bak-${Date.now()}`;
        fs.renameSync(finalDir, backupDir);
      }

      fs.renameSync(stageDir, finalDir);
      stageDir = '';
      if (backupDir) {
        fs.rmSync(backupDir, { recursive: true, force: true });
        backupDir = '';
      }

      const finalized = adaptOpenTixSkill(
        loadOpenTixSkillFromDirectory(finalDir),
      );
      const existing = state.installed[finalized.name];
      state.installed[finalized.name] = this.buildInstalledRecord(
        finalized,
        context,
        existing,
        contentHash,
        finalized.sourceRef,
      );

      if (!state.trustedSources[resolvedSource.canonical]) {
        state.trustedSources[resolvedSource.canonical] =
          this.buildTrustedSource(
            resolvedSource.type,
            resolvedSource.canonical,
            context.actor,
          );
      }

      this.writeState(state);
      this.appendAudit(
        upgradeName ? 'upgrade' : 'install',
        finalized,
        context,
        contentHash,
      );
      return state.installed[finalized.name];
    } catch (error) {
      if (backupDir) {
        const restoredDir = backupDir.replace(/\.bak-\d+$/, '');
        if (!fs.existsSync(restoredDir) && fs.existsSync(backupDir)) {
          fs.renameSync(backupDir, restoredDir);
          backupDir = '';
        }
      }
      throw error;
    } finally {
      fs.rmSync(materialized.workspaceDir, { recursive: true, force: true });
      if (stageDir) {
        fs.rmSync(stageDir, { recursive: true, force: true });
      }
      if (backupDir) {
        fs.rmSync(backupDir, { recursive: true, force: true });
      }
    }
  }

  private buildInstalledRecord(
    skill: AdaptedSkill,
    context: RegistryActionContext,
    existing: InstalledSkillRecord | undefined,
    contentHash: string,
    sourceRef = skill.sourceRef,
  ): InstalledSkillRecord {
    const now = new Date().toISOString();
    return {
      name: skill.name,
      version: skill.version,
      source: skill.source,
      directory: skill.directory,
      sourceRef,
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
      contentHash,
      skillApiVersion: skill.apiCompatibility.declared,
      apiCompatibility: skill.apiCompatibility,
      diagnostics: skill.diagnostics,
    };
  }

  private buildTrustedSource(
    type: TrustedSkillSourceRecord['type'],
    canonical: string,
    actor: string,
  ): TrustedSkillSourceRecord {
    return {
      type,
      canonical,
      addedAt: new Date().toISOString(),
      addedBy: actor,
    };
  }

  private restoreInstalledSkill(
    installed: InstalledSkillRecord,
    failure?: FailedSkillLoad,
  ): AdaptedSkill {
    const diagnostics: SkillDiagnostic[] = [...installed.diagnostics];
    if (failure) {
      diagnostics.push({
        severity: 'error',
        code: 'load_failed',
        message: failure.error,
      });
    } else if (!fs.existsSync(installed.directory)) {
      diagnostics.push({
        severity: 'error',
        code: 'missing_on_disk',
        message: 'Installed skill directory is missing from disk.',
      });
    }

    return {
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
        mode: permissionModeForLevel(installed.permissionLevel),
        installRequiresAdmin: installed.permissionLevel > 1,
        explicitApprovalRequired: installed.permissionLevel === 3,
        declared: [],
        reasons: ['restored from installed state'],
      },
      sourceRef: installed.sourceRef,
      apiCompatibility: installed.apiCompatibility,
      requires: installed.requires,
      install: installed.install,
      commands: [],
      diagnostics,
      id: `${installed.name}@${installed.version}`,
    };
  }

  private requireSkill(name: string): AdaptedSkill {
    const skill = this.getSkill(name);
    if (!skill) {
      registryError(
        `Skill "${name}" was not found. Checked: ${this.discoveryRoots().join(', ')}`,
      );
    }
    return skill;
  }

  private assertCompatible(skill: AdaptedSkill): void {
    if (skill.apiCompatibility.status === 'incompatible') {
      registryError(
        `Skill "${skill.name}" is not compatible with skill API ${skill.apiCompatibility.current}. ${skill.apiCompatibility.reason}`,
      );
    }
  }

  private assertManagementAllowed(
    context: RegistryActionContext,
    action: SkillAuditAction,
  ): void {
    if (this.config.adminOnly && !context.isAdmin) {
      registryError(`Only admin users can ${action} skills.`);
    }
  }

  private assertExecutableActionAllowed(
    skill: AdaptedSkill,
    context: RegistryActionContext,
    action: 'install' | 'upgrade' | 'enable',
  ): void {
    this.assertManagementAllowed(context, action);

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
      const parsed = JSON.parse(raw) as
        | SkillsRegistryState
        | {
            version?: number;
            installed?: Record<string, Partial<InstalledSkillRecord>>;
            trustedSources?: Record<string, TrustedSkillSourceRecord>;
          };

      if (!parsed || typeof parsed !== 'object') {
        return defaultState();
      }

      const installedEntries = Object.entries(parsed.installed || {}).map(
        ([name, value]) =>
          [name, this.normalizeInstalledRecord(name, value)] as const,
      );

      return {
        version: 2,
        installed: Object.fromEntries(installedEntries),
        trustedSources: parsed.trustedSources || {},
      };
    } catch {
      return defaultState();
    }
  }

  private normalizeInstalledRecord(
    name: string,
    value: Partial<InstalledSkillRecord>,
  ): InstalledSkillRecord {
    const now = new Date().toISOString();
    const directory = value.directory || '';
    const sourceRef = value.sourceRef || {
      type: 'local',
      spec: directory,
      canonical: directory,
      managed: false,
      trusted: true,
    };
    const permissionLevel = (value.permissionLevel ||
      1) as SkillPermissionLevel;

    return {
      name,
      version: value.version || '0.0.0',
      source: value.source || 'opentix',
      directory,
      sourceRef,
      description: value.description || name,
      enabled: value.enabled ?? false,
      permissionLevel,
      installedAt: value.installedAt || now,
      updatedAt: value.updatedAt || value.installedAt || now,
      installedBy: value.installedBy || 'unknown',
      lastActionBy: value.lastActionBy || value.installedBy || 'unknown',
      entrypoint: value.entrypoint,
      requires: value.requires || [],
      install: value.install || [],
      contentHash: value.contentHash,
      skillApiVersion: value.skillApiVersion,
      apiCompatibility: value.apiCompatibility || {
        current: '1.0.0',
        declared: value.skillApiVersion,
        status: value.skillApiVersion ? 'compatible' : 'unspecified',
        reason: value.skillApiVersion
          ? 'restored from installed state'
          : 'skill_api_version was not declared',
      },
      diagnostics: value.diagnostics || [],
    };
  }

  private writeState(state: SkillsRegistryState): void {
    ensureParentDir(this.config.statePath);
    fs.writeFileSync(this.config.statePath, JSON.stringify(state, null, 2));
  }

  private appendAudit(
    action: SkillAuditAction,
    skill: AdaptedSkill,
    context: RegistryActionContext,
    contentHash?: string,
  ): void {
    const event: SkillAuditEvent = {
      action,
      actor: context.actor,
      isAdmin: context.isAdmin,
      approved: !!context.approveLevel3,
      skill: skill.name,
      version: skill.version,
      permissionLevel: skill.permission.level,
      sourceType: skill.sourceRef.type,
      sourceCanonical: skill.sourceRef.canonical,
      managed: skill.sourceRef.managed,
      contentHash,
      timestamp: new Date().toISOString(),
    };

    ensureParentDir(this.config.auditLogPath);
    fs.appendFileSync(this.config.auditLogPath, `${JSON.stringify(event)}\n`);
    logger.info({ event }, 'skills audit event');
  }

  private managedSkillsRoot(): string {
    return path.join(path.dirname(this.config.statePath), 'packages');
  }

  private discoveryRoots(): string[] {
    return Array.from(
      new Set(
        [...this.config.directories, this.managedSkillsRoot()].map((entry) =>
          path.resolve(entry),
        ),
      ),
    );
  }

  private loadDiscoveredSkills(): {
    skills: AdaptedSkill[];
    failures: FailedSkillLoad[];
  } {
    const { skills, failures } = loadOpenTixSkillsDetailed(
      this.discoveryRoots(),
    );
    return {
      skills: skills.map((skill) => adaptOpenTixSkill(skill)),
      failures,
    };
  }
}
