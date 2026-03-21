import crypto from 'crypto';
import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { parseOpenClawSkillMarkdown } from './parser.js';
import type {
  DiscoveredSkill,
  FailedSkillLoad,
  ManagedSkillManifest,
  SkillApiCompatibility,
  SkillDiagnostic,
  SkillEntrypoint,
  SkillLayout,
  SkillSourceReference,
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
  'pyproject.toml',
  'mcp.json',
] as const;

const HASH_IGNORES = new Set(['.git', '.ticlaw-skill.json', 'node_modules']);
export const CURRENT_SKILL_API_VERSION = '1.0.0';
export const MANAGED_SKILL_MANIFEST = '.ticlaw-skill.json';

interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
}

interface ResolvedSkillSource {
  type: SkillSourceReference['type'];
  spec: string;
  canonical: string;
  path?: string;
  ref?: string;
  packageSpec?: string;
}

export interface MaterializedSkillSource {
  sourceRef: SkillSourceReference;
  workspaceDir: string;
  skillDir: string;
}

function normalizeRelativePath(
  skillDir: string,
  value?: string,
): string | undefined {
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

function skillLayout(skillDir: string, skillFilePath: string): SkillLayout {
  return {
    hasSkillFile: fs.existsSync(skillFilePath),
    hasPackageJson: fs.existsSync(path.join(skillDir, 'package.json')),
    hasSrcDir: fs.existsSync(path.join(skillDir, 'src')),
    hasScriptsDir: fs.existsSync(path.join(skillDir, 'scripts')),
    hasTestsDir: fs.existsSync(path.join(skillDir, 'tests')),
  };
}

function parseVersion(value: string): ParsedVersion | undefined {
  const match = value.trim().match(/^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?$/);
  if (!match) return undefined;
  return {
    major: Number(match[1]),
    minor: Number(match[2] || 0),
    patch: Number(match[3] || 0),
  };
}

function compareVersions(left: ParsedVersion, right: ParsedVersion): number {
  if (left.major !== right.major) return left.major - right.major;
  if (left.minor !== right.minor) return left.minor - right.minor;
  return left.patch - right.patch;
}

export function resolveSkillApiCompatibility(
  declared?: string,
  current = CURRENT_SKILL_API_VERSION,
): SkillApiCompatibility {
  if (!declared) {
    return {
      current,
      status: 'unspecified',
      reason: 'skill_api_version was not declared',
    };
  }

  const trimmed = declared.trim();
  if (!trimmed) {
    return {
      current,
      status: 'unspecified',
      reason: 'skill_api_version was empty',
    };
  }

  if (trimmed === '*') {
    return {
      current,
      declared: trimmed,
      status: 'compatible',
      reason: 'skill_api_version accepts any compatibility layer version',
    };
  }

  const currentVersion = parseVersion(current);
  if (!currentVersion) {
    return {
      current,
      declared: trimmed,
      status: 'incompatible',
      reason: `Current skill API version "${current}" is not semver-like.`,
    };
  }

  const rangeMatch = trimmed.match(
    /^(>=|<=|>|<|\^|~)\s*(v?\d+(?:\.\d+){0,2})$/,
  );
  const exactVersion = parseVersion(trimmed);

  if (rangeMatch) {
    const [, operator, rawBase] = rangeMatch;
    const baseVersion = parseVersion(rawBase);
    if (!baseVersion) {
      return {
        current,
        declared: trimmed,
        status: 'incompatible',
        reason: `Unsupported skill_api_version "${trimmed}".`,
      };
    }

    const comparison = compareVersions(currentVersion, baseVersion);
    const compatible =
      operator === '>='
        ? comparison >= 0
        : operator === '<='
          ? comparison <= 0
          : operator === '>'
            ? comparison > 0
            : operator === '<'
              ? comparison < 0
              : operator === '^'
                ? currentVersion.major === baseVersion.major && comparison >= 0
                : currentVersion.major === baseVersion.major &&
                  currentVersion.minor === baseVersion.minor &&
                  comparison >= 0;

    return {
      current,
      declared: trimmed,
      status: compatible ? 'compatible' : 'incompatible',
      reason: compatible
        ? `Current skill API ${current} satisfies ${trimmed}.`
        : `Current skill API ${current} does not satisfy ${trimmed}.`,
    };
  }

  if (!exactVersion) {
    return {
      current,
      declared: trimmed,
      status: 'incompatible',
      reason: `Unsupported skill_api_version "${trimmed}".`,
    };
  }

  const compatible =
    currentVersion.major === exactVersion.major &&
    compareVersions(currentVersion, exactVersion) >= 0;
  return {
    current,
    declared: trimmed,
    status: compatible ? 'compatible' : 'incompatible',
    reason: compatible
      ? `Current skill API ${current} is compatible with ${trimmed}.`
      : `Current skill API ${current} is not compatible with ${trimmed}.`,
  };
}

function splitGitRef(spec: string): { source: string; ref?: string } {
  const hashIndex = spec.lastIndexOf('#');
  if (hashIndex === -1) return { source: spec };
  return {
    source: spec.slice(0, hashIndex),
    ref: spec.slice(hashIndex + 1) || undefined,
  };
}

function resolveExistingPath(raw: string): string | undefined {
  try {
    return fs.realpathSync(raw);
  } catch {
    const resolved = path.resolve(raw);
    return fs.existsSync(resolved) ? resolved : undefined;
  }
}

function normalizeFileLikePath(spec: string): string {
  if (spec.startsWith('file://')) {
    return fileURLToPath(spec);
  }
  return spec;
}

function isArchivePath(filePath: string): boolean {
  return /\.(?:tgz|tar\.gz)$/i.test(filePath);
}

function isLikelyGitSpec(spec: string): boolean {
  return (
    spec.startsWith('git+') ||
    spec.startsWith('git@') ||
    /^https?:\/\/.+(?:\.git)?(?:#.+)?$/i.test(spec) ||
    /^ssh:\/\/.+(?:\.git)?(?:#.+)?$/i.test(spec)
  );
}

export function resolveSkillSourceSpec(spec: string): SkillSourceReference {
  const resolved = resolveThirdPartySkillSource(spec);
  return {
    type: resolved.type,
    spec: resolved.spec,
    canonical: resolved.canonical,
    managed: false,
    trusted: false,
  };
}

function resolveThirdPartySkillSource(spec: string): ResolvedSkillSource {
  const trimmed = spec.trim();
  if (!trimmed) {
    throw new Error('Skill source is empty.');
  }

  if (trimmed.startsWith('npm:')) {
    const packageSpec = trimmed.slice(4).trim();
    if (!packageSpec) {
      throw new Error('NPM skill sources must use the form "npm:<package>".');
    }
    return {
      type: 'npm',
      spec: trimmed,
      canonical: `npm:${packageSpec}`,
      packageSpec,
    };
  }

  if (trimmed.startsWith('git+') || isLikelyGitSpec(trimmed)) {
    const normalized = trimmed.startsWith('git+') ? trimmed.slice(4) : trimmed;
    const { source, ref } = splitGitRef(normalized);
    const maybeLocalPath = normalizeFileLikePath(source);
    const localPath = resolveExistingPath(maybeLocalPath);
    const cloneSource = localPath || source;
    const canonical = `${localPath || source}${ref ? `#${ref}` : ''}`;
    return {
      type: 'git',
      spec: trimmed,
      canonical,
      path: cloneSource,
      ref,
    };
  }

  const maybeLocalPath = normalizeFileLikePath(trimmed);
  const localPath = resolveExistingPath(maybeLocalPath);
  if (localPath) {
    return {
      type: 'local',
      spec: trimmed,
      canonical: localPath,
      path: localPath,
    };
  }

  throw new Error(
    `Skill source "${spec}" is not a discovered skill name and does not match supported third-party source formats. Use a local path, "git+<repo>", or "npm:<package>".`,
  );
}

function ensureDir(dirPath: string): void {
  fs.mkdirSync(dirPath, { recursive: true });
}

function copyDirectory(sourceDir: string, targetDir: string): void {
  ensureDir(path.dirname(targetDir));
  fs.cpSync(sourceDir, targetDir, { recursive: true, force: true });
}

function extractTarball(archivePath: string, targetDir: string): string {
  ensureDir(targetDir);
  execFileSync('tar', ['-xzf', archivePath, '-C', targetDir], {
    stdio: 'pipe',
  });

  const packageDir = path.join(targetDir, 'package');
  if (fs.existsSync(packageDir) && fs.statSync(packageDir).isDirectory()) {
    return packageDir;
  }

  const entries = fs
    .readdirSync(targetDir, { withFileTypes: true })
    .filter((entry) => entry.name !== path.basename(archivePath));
  if (entries.length === 1 && entries[0].isDirectory()) {
    return path.join(targetDir, entries[0].name);
  }

  return targetDir;
}

function materializeLocalSource(
  source: ResolvedSkillSource,
  targetDir: string,
): string {
  if (!source.path) {
    throw new Error(`Local source "${source.spec}" could not be resolved.`);
  }

  const stats = fs.statSync(source.path);
  if (stats.isDirectory()) {
    copyDirectory(source.path, targetDir);
    return targetDir;
  }

  if (stats.isFile() && isArchivePath(source.path)) {
    return extractTarball(source.path, targetDir);
  }

  throw new Error(
    `Local source "${source.spec}" must be a directory or .tgz/.tar.gz archive.`,
  );
}

function materializeGitSource(
  source: ResolvedSkillSource,
  targetDir: string,
): string {
  if (!source.path) {
    throw new Error(`Git source "${source.spec}" could not be resolved.`);
  }

  const args = ['clone', '--depth', '1', '--single-branch'];
  if (source.ref) {
    args.push('--branch', source.ref);
  }
  args.push(source.path, targetDir);
  execFileSync('git', args, { stdio: 'pipe' });
  fs.rmSync(path.join(targetDir, '.git'), { recursive: true, force: true });
  return targetDir;
}

function materializeNpmSource(
  source: ResolvedSkillSource,
  targetDir: string,
): string {
  if (!source.packageSpec) {
    throw new Error(`NPM source "${source.spec}" could not be resolved.`);
  }

  const packDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ticlaw-skill-pack-'));
  try {
    const npmCacheDir = path.join(packDir, '.npm-cache');
    ensureDir(npmCacheDir);
    const packRaw = execFileSync(
      'npm',
      ['pack', source.packageSpec, '--json'],
      {
        cwd: packDir,
        encoding: 'utf-8',
        env: {
          ...process.env,
          npm_config_cache: npmCacheDir,
          npm_config_userconfig: '/dev/null',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    const parsed = JSON.parse(packRaw) as Array<{ filename?: string }>;
    const tarballName = parsed[0]?.filename;
    if (!tarballName) {
      throw new Error(
        `npm pack did not return a tarball for "${source.packageSpec}".`,
      );
    }
    return extractTarball(path.join(packDir, tarballName), targetDir);
  } finally {
    fs.rmSync(packDir, { recursive: true, force: true });
  }
}

export function materializeSkillSource(spec: string): MaterializedSkillSource {
  const source = resolveThirdPartySkillSource(spec);
  const workspaceDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'ticlaw-skill-src-'),
  );
  const targetDir = path.join(workspaceDir, 'skill');

  const skillDir =
    source.type === 'local'
      ? materializeLocalSource(source, targetDir)
      : source.type === 'git'
        ? materializeGitSource(source, targetDir)
        : materializeNpmSource(source, targetDir);

  return {
    sourceRef: {
      type: source.type,
      spec: source.spec,
      canonical: source.canonical,
      managed: false,
      trusted: false,
    },
    workspaceDir,
    skillDir,
  };
}

export function hashSkillDirectory(skillDir: string): string {
  const hash = crypto.createHash('sha256');

  const visit = (currentDir: string): void => {
    const entries = fs
      .readdirSync(currentDir, { withFileTypes: true })
      .filter((entry) => !HASH_IGNORES.has(entry.name))
      .sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      const relativePath = path
        .relative(skillDir, fullPath)
        .split(path.sep)
        .join('/');

      hash.update(`${relativePath}\n`);

      if (entry.isDirectory()) {
        hash.update('dir\n');
        visit(fullPath);
        continue;
      }

      if (entry.isSymbolicLink()) {
        hash.update(`symlink:${fs.readlinkSync(fullPath)}\n`);
        continue;
      }

      hash.update('file\n');
      hash.update(fs.readFileSync(fullPath));
      hash.update('\n');
    }
  };

  visit(skillDir);
  return hash.digest('hex');
}

function readManagedSkillManifest(skillDir: string): {
  manifest?: ManagedSkillManifest;
  diagnostics: SkillDiagnostic[];
} {
  const manifestPath = path.join(skillDir, MANAGED_SKILL_MANIFEST);
  if (!fs.existsSync(manifestPath)) {
    return { diagnostics: [] };
  }

  try {
    const manifest = JSON.parse(
      fs.readFileSync(manifestPath, 'utf-8'),
    ) as ManagedSkillManifest;
    return { manifest, diagnostics: [] };
  } catch (error) {
    return {
      diagnostics: [
        {
          severity: 'warning',
          code: 'managed_manifest_invalid',
          message:
            error instanceof Error
              ? error.message
              : 'Managed skill manifest could not be parsed.',
        },
      ],
    };
  }
}

export function writeManagedSkillManifest(
  skillDir: string,
  manifest: ManagedSkillManifest,
): void {
  fs.writeFileSync(
    path.join(skillDir, MANAGED_SKILL_MANIFEST),
    JSON.stringify(manifest, null, 2),
  );
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

export function loadOpenClawSkillFromDirectory(
  skillDir: string,
): DiscoveredSkill {
  const skillFilePath = path.join(skillDir, 'SKILL.md');
  const diagnostics: SkillDiagnostic[] = [];

  if (!fs.existsSync(skillFilePath)) {
    throw new Error(`No SKILL.md found in ${skillDir}`);
  }

  const { manifest, diagnostics: manifestDiagnostics } =
    readManagedSkillManifest(skillDir);
  diagnostics.push(...manifestDiagnostics);

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

  const apiCompatibility = resolveSkillApiCompatibility(
    parsed.metadata.skillApiVersion,
  );
  if (apiCompatibility.status === 'incompatible') {
    diagnostics.push({
      severity: 'error',
      code: 'skill_api_incompatible',
      message: apiCompatibility.reason,
    });
  }

  if (manifest) {
    const currentHash = hashSkillDirectory(skillDir);
    if (currentHash !== manifest.contentHash) {
      diagnostics.push({
        severity: 'warning',
        code: 'content_hash_drift',
        message:
          'Managed skill contents no longer match the recorded SHA-256. Upgrade or reinstall before enabling.',
      });
    }
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
    sourceRef: manifest?.sourceRef || {
      type: 'local',
      spec: skillDir,
      canonical: resolveExistingPath(skillDir) || path.resolve(skillDir),
      managed: false,
      trusted: true,
    },
    apiCompatibility,
    diagnostics,
    source: 'openclaw',
  };
}

export function discoverOpenClawSkillDirectories(
  skillRoots: string[],
): string[] {
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

export function loadOpenClawSkillsDetailed(skillRoots: string[]): {
  skills: DiscoveredSkill[];
  failures: FailedSkillLoad[];
} {
  const skills: DiscoveredSkill[] = [];
  const failures: FailedSkillLoad[] = [];

  for (const skillDir of discoverOpenClawSkillDirectories(skillRoots)) {
    try {
      skills.push(loadOpenClawSkillFromDirectory(skillDir));
    } catch (error) {
      const { manifest } = readManagedSkillManifest(skillDir);
      failures.push({
        directory: skillDir,
        error: error instanceof Error ? error.message : String(error),
        manifest,
      });
    }
  }

  return { skills, failures };
}

export function loadOpenClawSkills(skillRoots: string[]): DiscoveredSkill[] {
  return loadOpenClawSkillsDetailed(skillRoots).skills;
}
