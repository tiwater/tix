import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { readConfigYaml } from '../core/env.js';
import { SkillsRegistry } from './registry.js';
import type {
  ListedSkill,
  RegistryActionContext,
  SkillAuditEvent,
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
    '- /skills auth status [name] [--json]',
    '- /skills auth login <name>',
    '- /skills auth logout <name>',
    '- /skills audit [--limit <n>] [--json]',
  ].join('\n');
}

type SkillAuthAction = 'status' | 'login' | 'logout';
type SkillAuthState =
  | 'authenticated'
  | 'unauthenticated'
  | 'unsupported'
  | 'error';

interface SkillAuthResult {
  skill: string;
  action: SkillAuthAction;
  state: SkillAuthState;
  authenticated: boolean | null;
  exit_code: number | null;
  script: string | null;
  output?: string;
  error?: string;
}

const AUTH_SCRIPT_CANDIDATES: Record<SkillAuthAction, string[]> = {
  status: [
    'scripts/auth-status.sh',
    'scripts/auth-status.mjs',
    'scripts/auth-status.js',
    'scripts/auth.sh',
  ],
  login: [
    'scripts/auth-login.sh',
    'scripts/auth-login.mjs',
    'scripts/auth-login.js',
    'scripts/auth.sh',
  ],
  logout: [
    'scripts/auth-logout.sh',
    'scripts/auth-logout.mjs',
    'scripts/auth-logout.js',
  ],
};

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
  limit?: number;
  args: string[];
  error?: string;
} {
  const args: string[] = [];
  let approve = false;
  let trust = false;
  let json = false;
  let hash: string | undefined;
  let limit: number | undefined;

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
          limit,
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
    if (token === '--limit') {
      const value = tokens[index + 1];
      if (!value) {
        return {
          approve,
          trust,
          json,
          hash,
          limit,
          args,
          error: 'Missing value for --limit.',
        };
      }
      const parsed = Number(value);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        return {
          approve,
          trust,
          json,
          hash,
          limit,
          args,
          error: 'Invalid value for --limit. Must be a positive number.',
        };
      }
      limit = Math.floor(parsed);
      index += 1;
      continue;
    }
    if (token.startsWith('--limit=')) {
      const raw = token.slice('--limit='.length);
      const parsed = Number(raw);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        return {
          approve,
          trust,
          json,
          hash,
          limit,
          args,
          error: 'Invalid value for --limit. Must be a positive number.',
        };
      }
      limit = Math.floor(parsed);
      continue;
    }
    args.push(token);
  }

  return { approve, trust, json, hash, limit, args };
}

function authHelpText(): string {
  return [
    'Skills auth commands:',
    '- /skills auth status [name] [--json]',
    '- /skills auth login <name>',
    '- /skills auth logout <name>',
    '',
    'Conventions:',
    '- status scripts should exit 0 when authenticated and 10 when unauthenticated.',
  ].join('\n');
}

function resolveAuthScriptPath(
  entry: ListedSkill,
  action: SkillAuthAction,
): string | undefined {
  for (const relativePath of AUTH_SCRIPT_CANDIDATES[action]) {
    const fullPath = path.join(entry.skill.directory, relativePath);
    if (fs.existsSync(fullPath)) {
      return fullPath;
    }
  }
  return undefined;
}

function executeAuthScript(
  entry: ListedSkill,
  action: SkillAuthAction,
  scriptPath: string,
): { exitCode: number; stdout: string; stderr: string } {
  const extension = path.extname(scriptPath).toLowerCase();
  const computer = extension === '.sh' ? 'bash' : 'node';
  const interactive =
    action !== 'status' && process.stdin.isTTY && process.stdout.isTTY;

  const result = spawnSync(computer, [scriptPath], {
    cwd: entry.skill.directory,
    env: process.env,
    encoding: 'utf-8',
    stdio: interactive ? 'inherit' : 'pipe',
  });

  if (result.error) {
    return {
      exitCode: 1,
      stdout: '',
      stderr: result.error.message,
    };
  }

  return {
    exitCode: typeof result.status === 'number' ? result.status : 1,
    stdout:
      interactive || typeof result.stdout !== 'string'
        ? ''
        : result.stdout.trim(),
    stderr:
      interactive || typeof result.stderr !== 'string'
        ? ''
        : result.stderr.trim(),
  };
}

function classifyStatusResult(
  entry: ListedSkill,
  scriptPath: string | undefined,
  execution?: { exitCode: number; stdout: string; stderr: string },
): SkillAuthResult {
  if (!scriptPath) {
    return {
      skill: entry.skill.name,
      action: 'status',
      state: 'unsupported',
      authenticated: null,
      exit_code: null,
      script: null,
      error: 'No auth status script found.',
    };
  }

  if (!execution) {
    return {
      skill: entry.skill.name,
      action: 'status',
      state: 'error',
      authenticated: null,
      exit_code: 1,
      script: scriptPath,
      error: 'Auth status script did not execute.',
    };
  }

  if (execution.exitCode === 0) {
    return {
      skill: entry.skill.name,
      action: 'status',
      state: 'authenticated',
      authenticated: true,
      exit_code: 0,
      script: scriptPath,
      output: execution.stdout || undefined,
    };
  }

  if (execution.exitCode === 10) {
    return {
      skill: entry.skill.name,
      action: 'status',
      state: 'unauthenticated',
      authenticated: false,
      exit_code: 10,
      script: scriptPath,
      output: execution.stdout || undefined,
      error: execution.stderr || undefined,
    };
  }

  return {
    skill: entry.skill.name,
    action: 'status',
    state: 'error',
    authenticated: null,
    exit_code: execution.exitCode,
    script: scriptPath,
    output: execution.stdout || undefined,
    error: execution.stderr || undefined,
  };
}

function summarizeStatus(result: SkillAuthResult): string {
  const detail = (result.error || result.output || '').split('\n')[0].trim();
  return detail ? `${result.state} (${detail})` : result.state;
}

function formatAuthStatus(
  skillName: string | undefined,
  json = false,
): SkillsCommandResult {
  const registry = new SkillsRegistry();

  if (skillName) {
    const entry = registry.inspectSkill(skillName);
    if (!entry) {
      return fail(`Skill "${skillName}" was not found.`);
    }

    const scriptPath = resolveAuthScriptPath(entry, 'status');
    const execution = scriptPath
      ? executeAuthScript(entry, 'status', scriptPath)
      : undefined;
    const result = classifyStatusResult(entry, scriptPath, execution);

    if (json) {
      return ok(JSON.stringify(result, null, 2));
    }

    return ok(
      [
        `Auth status for ${result.skill}: ${result.state}`,
        result.script ? `- script: ${result.script}` : undefined,
        result.output ? `- output: ${result.output}` : undefined,
        result.error ? `- error: ${result.error}` : undefined,
      ]
        .filter(Boolean)
        .join('\n'),
    );
  }

  const entries = registry.listAvailable();
  const results = entries.map((entry) => {
    const scriptPath = resolveAuthScriptPath(entry, 'status');
    const execution = scriptPath
      ? executeAuthScript(entry, 'status', scriptPath)
      : undefined;
    return classifyStatusResult(entry, scriptPath, execution);
  });

  if (json) {
    return ok(JSON.stringify(results, null, 2));
  }

  if (results.length === 0) {
    return ok('No OpenClaw-compatible skills found.');
  }

  return ok(
    [
      'Skill auth status:',
      ...results.map(
        (result) => `- ${result.skill}: ${summarizeStatus(result)}`,
      ),
    ].join('\n'),
  );
}

function executeAuthAction(
  action: Exclude<SkillAuthAction, 'status'>,
  skillName: string,
): SkillsCommandResult {
  const registry = new SkillsRegistry();
  const entry = registry.inspectSkill(skillName);
  if (!entry) {
    return fail(`Skill "${skillName}" was not found.`);
  }

  const scriptPath = resolveAuthScriptPath(entry, action);
  if (!scriptPath) {
    return fail(
      `Skill "${skillName}" does not implement auth ${action}. Expected one of: ${AUTH_SCRIPT_CANDIDATES[action].join(', ')}`,
    );
  }

  const result = executeAuthScript(entry, action, scriptPath);
  if (result.exitCode === 0) {
    const verb = action === 'login' ? 'Authenticated' : 'Logged out';
    return ok(`${verb} skill "${skillName}".`);
  }

  const details = [result.stdout, result.stderr].filter(Boolean).join('\n');
  return fail(
    [
      `Skill "${skillName}" auth ${action} failed (exit ${result.exitCode}).`,
      details || undefined,
    ]
      .filter(Boolean)
      .join('\n'),
  );
}

function executeAuthCommand(
  args: string[],
  context: RegistryActionContext,
  json = false,
): SkillsCommandResult {
  if (!context.isAdmin) {
    return fail('Only admin users can run /skills auth commands.');
  }

  const [subcommand, skillName] = args;
  switch (subcommand) {
    case undefined:
    case 'help':
      return ok(authHelpText());
    case 'status':
      return formatAuthStatus(skillName, json);
    case 'login':
      if (json) {
        return fail('--json is only supported for /skills auth status.');
      }
      return skillName
        ? executeAuthAction('login', skillName)
        : fail('Usage: /skills auth login <name>');
    case 'logout':
      if (json) {
        return fail('--json is only supported for /skills auth status.');
      }
      return skillName
        ? executeAuthAction('logout', skillName)
        : fail('Usage: /skills auth logout <name>');
    default:
      return fail(`${authHelpText()}\n\nUnknown auth command: ${subcommand}`);
  }
}

function formatAuditEntry(event: SkillAuditEvent): string {
  return [
    `- [${event.timestamp}] ${event.action} ${event.skill}@${event.version}`,
    `  actor=${event.actor}`,
    `  level=L${event.permissionLevel}`,
    `  source=${event.sourceType}`,
    `  managed=${event.managed}`,
    `  approved=${event.approved}`,
    event.contentHash ? `  hash=${event.contentHash}` : undefined,
  ]
    .filter(Boolean)
    .join(' | ');
}

function formatAudit(json = false, limit = 20): SkillsCommandResult {
  const registry = new SkillsRegistry();
  const config = registry.getConfig();

  if (!fs.existsSync(config.auditLogPath)) {
    return ok('No skills audit events found yet.');
  }

  const raw = fs.readFileSync(config.auditLogPath, 'utf-8');
  const lines = raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const events: SkillAuditEvent[] = [];
  for (const line of lines) {
    try {
      events.push(JSON.parse(line) as SkillAuditEvent);
    } catch {
      // ignore malformed rows
    }
  }

  if (events.length === 0) {
    return ok('No valid skills audit events found.');
  }

  const recent = events.slice(-limit).reverse();

  if (json) {
    return ok(JSON.stringify(recent, null, 2));
  }

  return ok(
    [
      `Recent skills audit events (latest ${recent.length}/${events.length}):`,
      ...recent.map((event) => formatAuditEntry(event)),
    ].join('\n'),
  );
}

function executeMutation(
  action: 'install' | 'upgrade' | 'enable' | 'disable' | 'remove',
  target: string,
  context: RegistryActionContext,
  options: SkillInstallOptions = {},
): SkillsCommandResult {
  const registry = new SkillsRegistry();
  const configProxy = readConfigYaml(['HTTPS_PROXY'])['HTTPS_PROXY'];
  const mutationOptions: SkillInstallOptions = {
    ...options,
    proxy: options.proxy || configProxy,
  };

  try {
    if (action === 'install') {
      const record = registry.installSkill(target, context, mutationOptions);
      return ok(
        `Installed ${record.name} (${record.version}) from ${record.sourceRef.type}. Enabled=${record.enabled}.`,
      );
    }

    if (action === 'upgrade') {
      const record = registry.upgradeSkill(target, context, mutationOptions);
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
    case 'auth':
      return executeAuthCommand(
        parsed.args.slice(1),
        commandContext,
        parsed.json,
      );
    case 'audit':
      return formatAudit(parsed.json, parsed.limit || 20);
    default:
      return fail(`${helpText()}\n\nUnknown command: ${command}`);
  }
}
