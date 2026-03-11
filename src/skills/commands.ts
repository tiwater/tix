import { SkillsRegistry } from './registry.js';
import type {
  ListedSkill,
  RegistryActionContext,
  SkillInstallOptions,
  SkillsCommandResult,
} from './types.js';

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
    '- /skills list [--json]',
    '- /skills inspect <name>',
    '- /skills install <name|path|git+repo|npm:package> [--trust] [--hash <sha256>] [--approve]',
    '- /skills upgrade <name> [--hash <sha256>] [--approve]',
    '- /skills enable <name> [--approve]',
    '- /skills disable <name>',
    '- /skills remove <name>',
  ].join('\n');
}

function ok(message: string): SkillsCommandResult {
  return { ok: true, exitCode: 0, message };
}

function fail(message: string, exitCode = 1): SkillsCommandResult {
  return { ok: false, exitCode, message };
}

function skillStatus(entry: ListedSkill): string {
  if (entry.installed) {
    if (!entry.discovered) return 'installed/unavailable';
    return entry.installed.enabled ? 'installed/enabled' : 'installed/disabled';
  }
  return entry.discovered ? 'available' : 'unavailable';
}

function listEntryJson(entry: ListedSkill) {
  return {
    name: entry.skill.name,
    version: entry.skill.version,
    description: entry.skill.description,
    status: skillStatus(entry),
    discovered: entry.discovered,
    installed: !!entry.installed,
    enabled: entry.installed?.enabled ?? false,
    managed: entry.skill.sourceRef.managed,
    source_type: entry.skill.sourceRef.type,
    source_spec: entry.skill.sourceRef.spec,
    source_canonical: entry.skill.sourceRef.canonical,
    trusted: entry.skill.sourceRef.trusted,
    directory: entry.skill.directory,
    permission: {
      level: entry.skill.permission.level,
      mode: entry.skill.permission.mode,
    },
    skill_api_version: entry.skill.apiCompatibility.declared || null,
    skill_api_status: entry.skill.apiCompatibility.status,
    diagnostics: entry.skill.diagnostics,
  };
}

function formatList(json = false): string {
  const registry = new SkillsRegistry();
  const skills = registry.listAvailable();
  if (json) {
    return JSON.stringify(
      skills.map((entry) => listEntryJson(entry)),
      null,
      2,
    );
  }

  if (skills.length === 0) {
    return [
      'No OpenClaw-compatible skills found.',
      `Configured directories: ${registry.getConfig().directories.join(', ')}`,
    ].join('\n');
  }

  return [
    'Available skills:',
    ...skills.map((entry) => {
      const source = entry.skill.sourceRef.managed
        ? `${entry.skill.sourceRef.type}/managed`
        : entry.skill.sourceRef.type;
      return `- ${entry.skill.name} [L${entry.skill.permission.level}] ${skillStatus(entry)} :: ${source} :: ${entry.skill.description}`;
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
    `- status: ${skillStatus(entry)}`,
    `- source: ${skill.source}`,
    `- source type: ${skill.sourceRef.type}`,
    `- source spec: ${skill.sourceRef.spec}`,
    `- source canonical: ${skill.sourceRef.canonical}`,
    `- managed: ${skill.sourceRef.managed}`,
    `- trusted: ${skill.sourceRef.trusted}`,
    `- permission: Level ${skill.permission.level} / ${skill.permission.mode}`,
    `- description: ${skill.description}`,
    `- entrypoint: ${skill.entrypoint?.path || 'none detected'}`,
    `- requires: ${skill.requires.join(', ') || 'none'}`,
    `- install: ${skill.install.join(' | ') || 'none'}`,
    `- skill_api_version: ${skill.apiCompatibility.declared || 'unspecified'}`,
    `- skill_api_status: ${skill.apiCompatibility.status}`,
    `- skill_api_reason: ${skill.apiCompatibility.reason}`,
  ];

  if (installed?.contentHash) {
    lines.push(`- content_hash: ${installed.contentHash}`);
  }
  if (skill.permission.reasons.length > 0) {
    lines.push(
      `- permission reasoning: ${skill.permission.reasons.join('; ')}`,
    );
  }
  if (skill.diagnostics.length > 0) {
    lines.push(
      `- diagnostics: ${skill.diagnostics.map((item) => `${item.severity}:${item.code}`).join(', ')}`,
    );
  }
  return ok(lines.join('\n'));
}

function parseFlags(tokens: string[]): {
  approve: boolean;
  trust: boolean;
  json: boolean;
  hash?: string;
  args: string[];
  error?: string;
} {
  const args: string[] = [];
  let approve = false;
  let trust = false;
  let json = false;
  let hash: string | undefined;

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === '--approve' || token === 'approve') {
      approve = true;
      continue;
    }
    if (token === '--trust' || token === 'trust') {
      trust = true;
      continue;
    }
    if (token === '--json' || token === 'json') {
      json = true;
      continue;
    }
    if (token === '--hash') {
      const value = tokens[index + 1];
      if (!value) {
        return {
          approve,
          trust,
          json,
          hash,
          args,
          error: 'Missing value for --hash.',
        };
      }
      hash = value;
      index += 1;
      continue;
    }
    if (token.startsWith('--hash=')) {
      hash = token.slice('--hash='.length);
      continue;
    }
    args.push(token);
  }

  return { approve, trust, json, hash, args };
}

function executeMutation(
  action: 'install' | 'upgrade' | 'enable' | 'disable' | 'remove',
  target: string,
  context: RegistryActionContext,
  options: SkillInstallOptions = {},
): SkillsCommandResult {
  const registry = new SkillsRegistry();

  try {
    if (action === 'install') {
      const record = registry.installSkill(target, context, options);
      return ok(
        `Installed ${record.name} (${record.version}) from ${record.sourceRef.type}. Enabled=${record.enabled}.`,
      );
    }

    if (action === 'upgrade') {
      const record = registry.upgradeSkill(target, context, options);
      return ok(
        `Upgraded ${record.name} to ${record.version}. Source=${record.sourceRef.type}.`,
      );
    }

    if (action === 'enable') {
      const record = registry.enableSkill(target, context);
      return ok(`Enabled ${record.name} (${record.version}).`);
    }

    if (action === 'disable') {
      const record = registry.disableSkill(target, context);
      return ok(`Disabled ${record.name} (${record.version}).`);
    }

    const record = registry.removeSkill(target, context);
    return ok(`Removed ${record.name} (${record.version}).`);
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

  const parsed = parseFlags(tokens);
  if (parsed.error) return fail(parsed.error);

  const [command, target] = parsed.args;
  const commandContext: RegistryActionContext = {
    actor: context.actor || 'unknown',
    isAdmin: !!context.isAdmin,
    approveLevel3: parsed.approve || !!context.approveLevel3,
  };
  const installOptions: SkillInstallOptions = {
    expectedHash: parsed.hash,
    trustSource: parsed.trust,
  };

  switch (command) {
    case 'help':
      return ok(helpText());
    case 'list':
      return ok(formatList(parsed.json));
    case 'inspect':
      return target
        ? formatInspect(target)
        : fail('Usage: /skills inspect <name>');
    case 'install':
    case 'add':
      return target
        ? executeMutation('install', target, commandContext, installOptions)
        : fail(
            'Usage: /skills install <name|path|git+repo|npm:package> [--trust] [--hash <sha256>] [--approve]',
          );
    case 'upgrade':
      return target
        ? executeMutation('upgrade', target, commandContext, installOptions)
        : fail('Usage: /skills upgrade <name> [--hash <sha256>] [--approve]');
    case 'enable':
      return target
        ? executeMutation('enable', target, commandContext)
        : fail('Usage: /skills enable <name> [--approve]');
    case 'disable':
      return target
        ? executeMutation('disable', target, commandContext)
        : fail('Usage: /skills disable <name>');
    case 'remove':
      return target
        ? executeMutation('remove', target, commandContext)
        : fail('Usage: /skills remove <name>');
    default:
      return fail(`${helpText()}\n\nUnknown command: ${command}`);
  }
}
