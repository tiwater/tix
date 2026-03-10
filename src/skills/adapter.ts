import type {
  AdaptedSkill,
  DiscoveredSkill,
  SkillPermissionLevel,
  SkillPermissionProfile,
} from './types.js';

const LEVEL_3_HINTS = [
  'level 3',
  'level3',
  'high',
  'privileged',
  'privilege',
  'sudo',
  'root',
  'admin',
  'dangerous',
  'network',
  'write',
  'shell',
] as const;

const LEVEL_2_HINTS = [
  'level 2',
  'level2',
  'execute',
  'exec',
  'tool',
  'command',
  'sandbox',
  'run',
] as const;

const LEVEL_1_HINTS = ['level 1', 'level1', 'read', 'readonly', 'inspect'] as const;

function detectDeclaredLevel(declared: string[]): SkillPermissionLevel | undefined {
  const joined = declared.join(' ').toLowerCase();
  if (joined.includes('level 3') || joined.includes('level3')) return 3;
  if (joined.includes('level 2') || joined.includes('level2')) return 2;
  if (joined.includes('level 1') || joined.includes('level1')) return 1;
  return undefined;
}

function permissionProfileForLevel(
  level: SkillPermissionLevel,
  declared: string[],
  reasons: string[],
): SkillPermissionProfile {
  if (level === 1) {
    return {
      level,
      mode: 'read-only',
      installRequiresAdmin: false,
      explicitApprovalRequired: false,
      declared,
      reasons,
    };
  }

  if (level === 2) {
    return {
      level,
      mode: 'sandboxed-exec',
      installRequiresAdmin: true,
      explicitApprovalRequired: false,
      declared,
      reasons,
    };
  }

  return {
    level,
    mode: 'privileged-exec',
    installRequiresAdmin: true,
    explicitApprovalRequired: true,
    declared,
    reasons,
  };
}

export function resolveSkillPermission(skill: DiscoveredSkill): SkillPermissionProfile {
  const declared = skill.parsed.metadata.permissions;
  const reasons: string[] = [];

  const declaredLevel = detectDeclaredLevel(declared);
  if (declaredLevel) {
    reasons.push(`declared as Level ${declaredLevel} in SKILL.md`);
    return permissionProfileForLevel(declaredLevel, declared, reasons);
  }

  const haystacks = [
    declared.join(' '),
    skill.parsed.metadata.install.join(' '),
    skill.entrypoint?.path || '',
    skill.description,
  ]
    .join(' ')
    .toLowerCase();

  if (LEVEL_3_HINTS.some((hint) => haystacks.includes(hint))) {
    reasons.push('detected high-privilege capabilities in permissions/install metadata');
    return permissionProfileForLevel(3, declared, reasons);
  }

  if (
    LEVEL_2_HINTS.some((hint) => haystacks.includes(hint)) ||
    skill.parsed.metadata.install.length > 0 ||
    skill.entrypoint
  ) {
    reasons.push('detected executable entrypoint or install steps');
    return permissionProfileForLevel(2, declared, reasons);
  }

  if (LEVEL_1_HINTS.some((hint) => haystacks.includes(hint))) {
    reasons.push('detected read-only permission hints');
  } else {
    reasons.push('defaulted to read-only because no execution or privilege hints were found');
  }
  return permissionProfileForLevel(1, declared, reasons);
}

export function adaptOpenClawSkill(skill: DiscoveredSkill): AdaptedSkill {
  const permission = resolveSkillPermission(skill);
  const version = skill.version || '0.0.0';

  return {
    id: `${skill.name}@${version}`,
    source: skill.source,
    name: skill.name,
    description: skill.description,
    version,
    directory: skill.directory,
    entrypoint: skill.entrypoint,
    permission,
    requires: skill.parsed.metadata.requires,
    install: skill.parsed.metadata.install,
    commands: [
      `/skills inspect ${skill.name}`,
      `/skills install ${skill.name}`,
      `/skills enable ${skill.name}`,
      `/skills disable ${skill.name}`,
    ],
    diagnostics: skill.diagnostics,
  };
}
