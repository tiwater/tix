import { SkillsRegistry } from './registry.js';
import type { SkillsCommandResult, RegistryActionContext } from './types.js';

function tokenize(input: string | string[]): string[] {
  if (Array.isArray(input)) {
    return input.map((part) => part.trim()).filter(Boolean);
  }
  return input
    .trim()
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function helpText(): string {
  return [
    'Skills commands:',
    '- /skills list',
    '- /skills inspect <name>',
    '- /skills install <name> [--approve]',
    '- /skills enable <name> [--approve]',
    '- /skills disable <name>',
  ].join('\n');
}

function ok(message: string): SkillsCommandResult {
  return { ok: true, exitCode: 0, message };
}

function fail(message: string, exitCode = 1): SkillsCommandResult {
  return { ok: false, exitCode, message };
}

function formatList(): string {
  const registry = new SkillsRegistry();
  const skills = registry.listAvailable();
  if (skills.length === 0) {
    return [
      'No OpenClaw-compatible skills found.',
      `Configured directories: ${registry.getConfig().directories.join(', ')}`,
    ].join('\n');
  }

  return [
    'Available skills:',
    ...skills.map(({ skill, installed }) => {
      const status = installed
        ? installed.enabled
          ? 'installed/enabled'
          : 'installed/disabled'
        : 'available';
      return `- ${skill.name} [L${skill.permission.level}] ${status} :: ${skill.description}`;
    }),
  ].join('\n');
}

function formatInspect(name: string): SkillsCommandResult {
  const registry = new SkillsRegistry();
  const entry = registry.inspectSkill(name);
  if (!entry) {
    return fail(`Skill "${name}" was not found.`);
  }

  const { skill, installed } = entry;
  const lines = [
    `${skill.name} (${skill.version})`,
    `- source: ${skill.source}`,
    `- permission: Level ${skill.permission.level} / ${skill.permission.mode}`,
    `- description: ${skill.description}`,
    `- entrypoint: ${skill.entrypoint?.path || 'none detected'}`,
    `- requires: ${skill.requires.join(', ') || 'none'}`,
    `- install: ${skill.install.join(' | ') || 'none'}`,
    `- status: ${installed ? (installed.enabled ? 'enabled' : 'disabled') : 'not installed'}`,
  ];

  if (skill.permission.reasons.length > 0) {
    lines.push(`- permission reasoning: ${skill.permission.reasons.join('; ')}`);
  }
  if (skill.diagnostics.length > 0) {
    lines.push(
      `- diagnostics: ${skill.diagnostics.map((item) => `${item.severity}:${item.code}`).join(', ')}`,
    );
  }
  return ok(lines.join('\n'));
}

function normalizeFlags(tokens: string[]) {
  const approve = tokens.includes('--approve') || tokens.includes('approve');
  return {
    approve,
    args: tokens.filter((token) => token !== '--approve' && token !== 'approve'),
  };
}

function executeMutation(
  action: 'install' | 'enable' | 'disable',
  name: string,
  context: RegistryActionContext,
): SkillsCommandResult {
  const registry = new SkillsRegistry();

  try {
    if (action === 'install') {
      const record = registry.installSkill(name, context);
      return ok(
        `Installed ${record.name} (${record.version}) as Level ${record.permissionLevel}. Enabled=${record.enabled}.`,
      );
    }

    if (action === 'enable') {
      const record = registry.enableSkill(name, context);
      return ok(`Enabled ${record.name} (${record.version}).`);
    }

    const record = registry.disableSkill(name, context);
    return ok(`Disabled ${record.name} (${record.version}).`);
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
}

export function executeSkillsCommand(
  input: string | string[],
  context: Partial<RegistryActionContext> = {},
): SkillsCommandResult {
  const tokens = tokenize(input);
  if (tokens.length === 0) return ok(helpText());

  const { approve, args } = normalizeFlags(tokens);
  const [command, name] = args;
  const commandContext: RegistryActionContext = {
    actor: context.actor || 'unknown',
    isAdmin: !!context.isAdmin,
    approveLevel3: approve || !!context.approveLevel3,
  };

  switch (command) {
    case 'help':
      return ok(helpText());
    case 'list':
      return ok(formatList());
    case 'inspect':
      return name ? formatInspect(name) : fail('Usage: /skills inspect <name>');
    case 'install':
      return name
        ? executeMutation('install', name, commandContext)
        : fail('Usage: /skills install <name> [--approve]');
    case 'enable':
      return name
        ? executeMutation('enable', name, commandContext)
        : fail('Usage: /skills enable <name> [--approve]');
    case 'disable':
      return name
        ? executeMutation('disable', name, commandContext)
        : fail('Usage: /skills disable <name>');
    default:
      return fail(`${helpText()}\n\nUnknown command: ${command}`);
  }
}
