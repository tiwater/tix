import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';

export const WORKSPACE_ARTIFACTS_DIR = 'artifacts';
export const WORKSPACE_UPLOADS_DIR = 'uploads';
export const WORKSPACE_SCRATCH_DIR = 'scratch';

export interface ManagedWorkspaceLayout {
  root: string;
  artifacts: string;
  screenshots: string;
  generated: string;
  shared: string;
  uploads: string;
  scratch: string;
  readme: string;
}

export type ManagedArtifactKind = 'screenshot' | 'generated' | 'shared';

export interface ManagedArtifactResult {
  absPath: string;
  relPath: string;
  action: 'existing' | 'moved' | 'copied';
}

const IMAGE_OR_DOCUMENT_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.svg',
  '.pdf',
]);

function sanitizeBasename(filename: string): string {
  return path
    .basename(filename)
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+/, '') || 'artifact';
}

function uniqueArtifactName(filename: string): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `${stamp}-${randomUUID().slice(0, 8)}-${sanitizeBasename(filename)}`;
}

export function getManagedWorkspaceLayout(workspace: string): ManagedWorkspaceLayout {
  const artifacts = path.join(workspace, WORKSPACE_ARTIFACTS_DIR);
  return {
    root: workspace,
    artifacts,
    screenshots: path.join(artifacts, 'screenshots'),
    generated: path.join(artifacts, 'generated'),
    shared: path.join(artifacts, 'shared'),
    uploads: path.join(workspace, WORKSPACE_UPLOADS_DIR),
    scratch: path.join(workspace, WORKSPACE_SCRATCH_DIR),
    readme: path.join(artifacts, 'README.md'),
  };
}

export function ensureManagedWorkspaceLayout(workspace: string): ManagedWorkspaceLayout {
  const layout = getManagedWorkspaceLayout(workspace);
  for (const dir of [
    layout.artifacts,
    layout.screenshots,
    layout.generated,
    layout.shared,
    layout.uploads,
    layout.scratch,
  ]) {
    fs.mkdirSync(dir, { recursive: true });
  }

  if (!fs.existsSync(layout.readme)) {
    fs.writeFileSync(
      layout.readme,
      [
        '# Workspace artifacts',
        '',
        'TiClaw keeps agent-managed files in dedicated folders at the workspace root.',
        '',
        '- `screenshots/`: screenshots and captured images.',
        '- `generated/`: generated files that should be shared with the user.',
        '- `shared/`: files copied into the workspace from outside paths.',
        '',
        'Other managed workspace folders:',
        '- `../uploads/`: files uploaded by the user via the workspace upload API.',
        '- `../scratch/`: temporary working files that do not belong in the project tree.',
        '',
        'Agents should prefer these folders unless the user explicitly asks for a different project path.',
        '',
      ].join('\n'),
      'utf-8',
    );
  }

  return layout;
}

export function isWorkspacePath(workspace: string, candidatePath: string): boolean {
  const resolvedWorkspace = path.resolve(workspace);
  const resolvedCandidate = path.resolve(candidatePath);
  return (
    resolvedCandidate === resolvedWorkspace ||
    resolvedCandidate.startsWith(`${resolvedWorkspace}${path.sep}`)
  );
}

export function toWorkspaceRelativePath(workspace: string, absPath: string): string {
  return path.relative(path.resolve(workspace), path.resolve(absPath)).split(path.sep).join('/');
}

function isManagedWorkspaceRelPath(relPath: string): boolean {
  return (
    relPath === WORKSPACE_ARTIFACTS_DIR ||
    relPath.startsWith(`${WORKSPACE_ARTIFACTS_DIR}/`) ||
    relPath === WORKSPACE_UPLOADS_DIR ||
    relPath.startsWith(`${WORKSPACE_UPLOADS_DIR}/`) ||
    relPath === WORKSPACE_SCRATCH_DIR ||
    relPath.startsWith(`${WORKSPACE_SCRATCH_DIR}/`)
  );
}

function targetDirectoryForKind(layout: ManagedWorkspaceLayout, kind: ManagedArtifactKind): string {
  switch (kind) {
    case 'screenshot':
      return layout.screenshots;
    case 'shared':
      return layout.shared;
    case 'generated':
    default:
      return layout.generated;
  }
}

export function classifyManagedArtifact(filePath: string): ManagedArtifactKind {
  const ext = path.extname(filePath).toLowerCase();
  return IMAGE_OR_DOCUMENT_EXTENSIONS.has(ext) ? 'screenshot' : 'generated';
}

export function stageManagedWorkspaceArtifact(
  workspace: string,
  filePath: string,
  kind: ManagedArtifactKind,
): ManagedArtifactResult {
  const resolvedWorkspace = path.resolve(workspace);
  const resolvedPath = path.resolve(filePath);
  const layout = ensureManagedWorkspaceLayout(resolvedWorkspace);

  if (isWorkspacePath(resolvedWorkspace, resolvedPath)) {
    const relPath = toWorkspaceRelativePath(resolvedWorkspace, resolvedPath);
    if (isManagedWorkspaceRelPath(relPath)) {
      return { absPath: resolvedPath, relPath, action: 'existing' };
    }

    const shouldRelocateRootArtifact =
      kind === 'screenshot' && path.dirname(resolvedPath) === resolvedWorkspace;

    if (!shouldRelocateRootArtifact) {
      return { absPath: resolvedPath, relPath, action: 'existing' };
    }

    const destPath = path.join(
      targetDirectoryForKind(layout, kind),
      uniqueArtifactName(resolvedPath),
    );
    fs.renameSync(resolvedPath, destPath);
    return {
      absPath: destPath,
      relPath: toWorkspaceRelativePath(resolvedWorkspace, destPath),
      action: 'moved',
    };
  }

  const destPath = path.join(
    targetDirectoryForKind(layout, kind),
    uniqueArtifactName(resolvedPath),
  );
  fs.copyFileSync(resolvedPath, destPath);
  return {
    absPath: destPath,
    relPath: toWorkspaceRelativePath(resolvedWorkspace, destPath),
    action: 'copied',
  };
}
