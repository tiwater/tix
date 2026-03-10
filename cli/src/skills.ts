import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import type { Command } from 'commander';
import { PROJECT_ROOT } from './utils.js';

async function runCoreSkillsCommand(args: string[]): Promise<void> {
  const builtModulePath = path.join(PROJECT_ROOT, 'dist', 'skills', 'commands.js');
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
    .action(async () => runCoreSkillsCommand(['list']));

  skills
    .command('inspect <name>')
    .description('Show parsed SKILL.md metadata and resolved permissions')
    .action(async (name: string) => runCoreSkillsCommand(['inspect', name]));

  skills
    .command('install <name>')
    .description('Install a discovered skill into the TiClaw registry')
    .option('--approve', 'Explicitly approve a Level 3 skill')
    .action(async (name: string, options: { approve?: boolean }) =>
      runCoreSkillsCommand(
        options.approve ? ['install', name, '--approve'] : ['install', name],
      ),
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
    .description('Alias for `disable`')
    .action(async (name: string) => runCoreSkillsCommand(['disable', name]));
}
