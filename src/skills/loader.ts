import fs from 'fs';
import path from 'path';
import { parseOpenClawSkillMarkdown } from './parser.js';
import type {
  DiscoveredSkill,
  SkillDiagnostic,
  SkillEntrypoint,
  SkillLayout,
} from './types.js';

const ENTRYPOINT_CANDIDATES = [
  'index.js',
  'index.ts',
  'main.js',
  'main.ts',
  'run.sh',
  'main.py',
  'skill.js',
  'skill.ts',
  'src/index.ts',
  'src/index.js',
  'scripts/run.sh',
  'dist/index.js',
] as const;

function normalizeRelativePath(skillDir: string, value?: string): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return path.isAbsolute(trimmed)
    ? trimmed
    : path.resolve(skillDir, trimmed.replace(/^\.\/+/, ''));
}

function loadPackageEntrypoint(skillDir: string): SkillEntrypoint | undefined {
  const packageJsonPath = path.join(skillDir, 'package.json');
  if (!fs.existsSync(packageJsonPath)) return undefined;

  try {
    const parsed = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8')) as {
      bin?: string | Record<string, string>;
      main?: string;
    };

    if (typeof parsed.bin === 'string') {
      return {
        path: path.resolve(skillDir, parsed.bin),
        type: 'package-bin',
        exists: fs.existsSync(path.resolve(skillDir, parsed.bin)),
      };
    }

    if (parsed.bin && typeof parsed.bin === 'object') {
      const first = Object.values(parsed.bin)[0];
      if (first) {
        const resolved = path.resolve(skillDir, first);
        return {
          path: resolved,
          type: 'package-bin',
          exists: fs.existsSync(resolved),
        };
      }
    }

    if (typeof parsed.main === 'string' && parsed.main.trim()) {
      const resolved = path.resolve(skillDir, parsed.main);
      return {
        path: resolved,
        type: 'package-main',
        exists: fs.existsSync(resolved),
      };
    }
  } catch {
    return undefined;
  }

  return undefined;
}

export function detectSkillEntrypoint(
  skillDir: string,
  declaredEntry?: string,
): SkillEntrypoint | undefined {
  const declaredPath = normalizeRelativePath(skillDir, declaredEntry);
  if (declaredPath) {
    return {
      path: declaredPath,
      type: 'module',
      exists: fs.existsSync(declaredPath),
    };
  }

  const packageEntrypoint = loadPackageEntrypoint(skillDir);
  if (packageEntrypoint) return packageEntrypoint;

  for (const candidate of ENTRYPOINT_CANDIDATES) {
    const resolved = path.join(skillDir, candidate);
    if (fs.existsSync(resolved)) {
      return {
        path: resolved,
        type: 'script',
        exists: true,
      };
    }
  }

  return undefined;
}

function skillLayout(skillDir: string, skillFilePath: string): SkillLayout {
  return {
    hasSkillFile: fs.existsSync(skillFilePath),
    hasPackageJson: fs.existsSync(path.join(skillDir, 'package.json')),
    hasSrcDir: fs.existsSync(path.join(skillDir, 'src')),
    hasScriptsDir: fs.existsSync(path.join(skillDir, 'scripts')),
    hasTestsDir: fs.existsSync(path.join(skillDir, 'tests')),
  };
}

export function loadOpenClawSkillFromDirectory(skillDir: string): DiscoveredSkill {
  const skillFilePath = path.join(skillDir, 'SKILL.md');
  const diagnostics: SkillDiagnostic[] = [];

  if (!fs.existsSync(skillFilePath)) {
    throw new Error(`No SKILL.md found in ${skillDir}`);
  }

  const raw = fs.readFileSync(skillFilePath, 'utf-8');
  const parsed = parseOpenClawSkillMarkdown(raw);
  diagnostics.push(...parsed.diagnostics);

  const entrypoint = detectSkillEntrypoint(skillDir, parsed.metadata.entry);
  if (parsed.metadata.entry && entrypoint && !entrypoint.exists) {
    diagnostics.push({
      severity: 'error',
      code: 'entrypoint_missing',
      message: `Declared entrypoint not found: ${entrypoint.path}`,
    });
  }
  if (!parsed.metadata.entry && !entrypoint) {
    diagnostics.push({
      severity: 'info',
      code: 'entrypoint_not_detected',
      message:
        'No entrypoint was declared or detected. This skill will be treated as metadata-only until enabled through another wrapper.',
    });
  }

  return {
    name: parsed.metadata.name || path.basename(skillDir),
    description: parsed.metadata.description,
    version: parsed.metadata.version,
    directory: skillDir,
    skillFilePath,
    parsed,
    entrypoint,
    layout: skillLayout(skillDir, skillFilePath),
    diagnostics,
    source: 'openclaw',
  };
}

export function discoverOpenClawSkillDirectories(skillRoots: string[]): string[] {
  const directories = new Set<string>();

  for (const root of skillRoots) {
    if (!root || !fs.existsSync(root)) continue;
    const stats = fs.statSync(root);
    if (!stats.isDirectory()) continue;

    if (fs.existsSync(path.join(root, 'SKILL.md'))) {
      directories.add(path.resolve(root));
      continue;
    }

    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const skillDir = path.join(root, entry.name);
      if (fs.existsSync(path.join(skillDir, 'SKILL.md'))) {
        directories.add(path.resolve(skillDir));
      }
    }
  }

  return Array.from(directories).sort();
}

export function loadOpenClawSkills(skillRoots: string[]): DiscoveredSkill[] {
  return discoverOpenClawSkillDirectories(skillRoots).map((skillDir) =>
    loadOpenClawSkillFromDirectory(skillDir),
  );
}
