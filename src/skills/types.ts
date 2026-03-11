export type SkillCompatibilitySource = 'openclaw';
export type SkillPermissionLevel = 1 | 2 | 3;
export type SkillPermissionMode =
  | 'read-only'
  | 'sandboxed-exec'
  | 'privileged-exec';
export type SkillDiagnosticSeverity = 'info' | 'warning' | 'error';
export type SkillEntrypointType =
  | 'package-bin'
  | 'package-main'
  | 'module'
  | 'script';
export type SkillAuditAction = 'install' | 'enable' | 'disable';

export interface SkillDiagnostic {
  severity: SkillDiagnosticSeverity;
  code: string;
  message: string;
}

export interface OpenClawSkillMetadata {
  name: string;
  description: string;
  version?: string;
  requires: string[];
  install: string[];
  permissions: string[];
  entry?: string;
  source?: string;
}

export interface ParsedSkillSection {
  title: string;
  slug: string;
  body: string;
  lines: string[];
}

export interface ParsedOpenClawSkill {
  metadata: OpenClawSkillMetadata;
  title: string;
  frontmatter: Record<string, unknown>;
  sections: Record<string, ParsedSkillSection>;
  diagnostics: SkillDiagnostic[];
  raw: string;
}

export interface SkillEntrypoint {
  path: string;
  type: SkillEntrypointType;
  exists: boolean;
}

export interface SkillLayout {
  hasSkillFile: boolean;
  hasPackageJson: boolean;
  hasSrcDir: boolean;
  hasScriptsDir: boolean;
  hasTestsDir: boolean;
}

export interface DiscoveredSkill {
  name: string;
  description: string;
  version?: string;
  directory: string;
  skillFilePath: string;
  parsed: ParsedOpenClawSkill;
  entrypoint?: SkillEntrypoint;
  layout: SkillLayout;
  diagnostics: SkillDiagnostic[];
  source: SkillCompatibilitySource;
}

export interface SkillPermissionProfile {
  level: SkillPermissionLevel;
  mode: SkillPermissionMode;
  installRequiresAdmin: boolean;
  explicitApprovalRequired: boolean;
  declared: string[];
  reasons: string[];
}

export interface AdaptedSkill {
  id: string;
  source: SkillCompatibilitySource;
  name: string;
  description: string;
  version: string;
  directory: string;
  entrypoint?: SkillEntrypoint;
  permission: SkillPermissionProfile;
  requires: string[];
  install: string[];
  commands: string[];
  diagnostics: SkillDiagnostic[];
}

export interface SkillsConfig {
  directories: string[];
  adminOnly: boolean;
  allowLevel3: boolean;
  autoEnableOnInstall: boolean;
  statePath: string;
  auditLogPath: string;
}

export interface InstalledSkillRecord {
  name: string;
  version: string;
  source: SkillCompatibilitySource;
  directory: string;
  description: string;
  enabled: boolean;
  permissionLevel: SkillPermissionLevel;
  installedAt: string;
  updatedAt: string;
  installedBy: string;
  lastActionBy: string;
  entrypoint?: string;
  requires: string[];
  install: string[];
  diagnostics: SkillDiagnostic[];
}

export interface SkillsRegistryState {
  version: 1;
  installed: Record<string, InstalledSkillRecord>;
}

export interface RegistryActionContext {
  actor: string;
  isAdmin: boolean;
  approveLevel3?: boolean;
}

export interface SkillAuditEvent {
  action: SkillAuditAction;
  actor: string;
  isAdmin: boolean;
  approved: boolean;
  skill: string;
  version: string;
  permissionLevel: SkillPermissionLevel;
  timestamp: string;
}

export interface ListedSkill {
  skill: AdaptedSkill;
  installed?: InstalledSkillRecord;
}

export interface SkillsCommandResult {
  ok: boolean;
  exitCode: number;
  message: string;
}
