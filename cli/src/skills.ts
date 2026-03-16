import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import type { Command } from 'commander';
import { PROJECT_ROOT } from './utils.js';

async function runCoreSkillsCommand(args: string[]): Promise<void> {
  const builtModulePath = path.join(
    PROJECT_ROOT,
    'dist',
    'skills',
    'commands.js',
  );
  if (!fs.existsSync(builtModulePath)) {
    console.error(
      'Core skills module is not built yet. Run `pnpm run build` first.',
    );
    process.exit(1);
  }

  const mod = (await import(pathToFileURL(builtModulePath).href)) as {
    executeSkillsCommand: (
      input: string[],
      context?: { actor: string; isAdmin: boolean; approveLevel3?: boolean },
    ) => { ok: boolean; exitCode: number; message: string };
  };

  const result = mod.executeSkillsCommand(args, {
    actor: 'cli',
    isAdmin: true,
    approveLevel3: args.includes('--approve'),
  });

  console.log(result.message);
  if (!result.ok) {
    process.exit(result.exitCode);
  }
}

export function registerSkillsCommand(program: Command): void {
  const skills = program
    .command('skills')
    .description('Manage OpenClaw-compatible skills');

  skills
    .command('list')
    .description('List discovered skills and their installed state')
    .option('--json', 'Emit machine-readable JSON')
    .action(async (options: { json?: boolean }) =>
      runCoreSkillsCommand(options.json ? ['list', '--json'] : ['list']),
    );

  skills
    .command('inspect <name>')
    .description('Show parsed SKILL.md metadata and resolved permissions')
    .action(async (name: string) => runCoreSkillsCommand(['inspect', name]));

  skills
    .command('install <target>')
    .description(
      'Install a skill by discovered name, local path, git repo, or npm package',
    )
    .option('--approve', 'Explicitly approve a Level 3 skill')
    .option('--trust', 'Whitelist a third-party skill source during install')
    .option(
      '--hash <sha256>',
      'Verify the installed skill contents against this SHA-256',
    )
    .action(
      async (
        target: string,
        options: { approve?: boolean; trust?: boolean; hash?: string },
      ) => {
        const args = ['install', target];
        if (options.trust) args.push('--trust');
        if (options.hash) args.push('--hash', options.hash);
        if (options.approve) args.push('--approve');
        await runCoreSkillsCommand(args);
      },
    );

  skills
    .command('upgrade <name>')
    .description('Upgrade an installed skill from its recorded source')
    .option('--approve', 'Explicitly approve a Level 3 skill')
    .option(
      '--hash <sha256>',
      'Verify the upgraded skill contents against this SHA-256',
    )
    .action(
      async (name: string, options: { approve?: boolean; hash?: string }) => {
        const args = ['upgrade', name];
        if (options.hash) args.push('--hash', options.hash);
        if (options.approve) args.push('--approve');
        await runCoreSkillsCommand(args);
      },
    );

  skills
    .command('enable <name>')
    .description('Enable an installed skill')
    .option('--approve', 'Explicitly approve a Level 3 skill')
    .action(async (name: string, options: { approve?: boolean }) =>
      runCoreSkillsCommand(
        options.approve ? ['enable', name, '--approve'] : ['enable', name],
      ),
    );

  skills
    .command('disable <name>')
    .description('Disable an installed skill')
    .action(async (name: string) => runCoreSkillsCommand(['disable', name]));

  skills
    .command('add <name>')
    .description('Alias for `install`')
    .action(async (name: string) => runCoreSkillsCommand(['install', name]));

  skills
    .command('remove <name>')
    .description(
      'Remove an installed skill and delete managed copies when present',
    )
    .action(async (name: string) => runCoreSkillsCommand(['remove', name]));

  const auth = skills
    .command('auth')
    .description('Check and manage authentication per skill');

  auth
    .command('status [name]')
    .description('Show auth status for one skill or all skills')
    .option('--json', 'Emit machine-readable JSON')
    .action(async (name: string | undefined, options: { json?: boolean }) => {
      const args = ['auth', 'status'];
      if (name) args.push(name);
      if (options.json) args.push('--json');
      await runCoreSkillsCommand(args);
    });

  auth
    .command('login <name>')
    .description('Authenticate one skill')
    .action(async (name: string) =>
      runCoreSkillsCommand(['auth', 'login', name]),
    );

  auth
    .command('logout <name>')
    .description('Clear authentication for one skill')
    .action(async (name: string) =>
      runCoreSkillsCommand(['auth', 'logout', name]),
    );
}
