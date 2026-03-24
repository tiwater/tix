import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';

import {
  WORKSPACE_ARTIFACTS_DIR,
  WORKSPACE_UPLOADS_DIR,
  ensureManagedWorkspaceLayout,
  stageManagedWorkspaceArtifact,
} from './workspace-layout.js';

describe('workspace layout management', () => {
  it('creates visible managed folders at the workspace root', () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'ticlaw-workspace-'));
    try {
      const layout = ensureManagedWorkspaceLayout(workspace);
      expect(layout.root).toBe(workspace);
      expect(fs.existsSync(layout.artifacts)).toBe(true);
      expect(fs.existsSync(layout.screenshots)).toBe(true);
      expect(fs.existsSync(layout.generated)).toBe(true);
      expect(fs.existsSync(layout.shared)).toBe(true);
      expect(fs.existsSync(layout.uploads)).toBe(true);
      expect(fs.existsSync(layout.scratch)).toBe(true);
      expect(fs.readFileSync(layout.readme, 'utf-8')).toContain('workspace root');
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  });

  it('moves root-level screenshots into artifacts/screenshots', () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'ticlaw-workspace-'));
    try {
      const screenshot = path.join(workspace, 'page.png');
      fs.writeFileSync(screenshot, 'png');

      const staged = stageManagedWorkspaceArtifact(workspace, screenshot, 'screenshot');

      expect(staged.action).toBe('moved');
      expect(staged.relPath.startsWith(`${WORKSPACE_ARTIFACTS_DIR}/screenshots/`)).toBe(true);
      expect(fs.existsSync(staged.absPath)).toBe(true);
      expect(fs.existsSync(screenshot)).toBe(false);
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  });

  it('copies external files into artifacts/shared', () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'ticlaw-workspace-'));
    const externalDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ticlaw-external-'));
    try {
      const external = path.join(externalDir, 'report.pdf');
      fs.writeFileSync(external, 'pdf');

      const staged = stageManagedWorkspaceArtifact(workspace, external, 'shared');

      expect(staged.action).toBe('copied');
      expect(staged.relPath.startsWith(`${WORKSPACE_ARTIFACTS_DIR}/shared/`)).toBe(true);
      expect(fs.existsSync(staged.absPath)).toBe(true);
      expect(fs.existsSync(external)).toBe(true);
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
      fs.rmSync(externalDir, { recursive: true, force: true });
    }
  });

  it('leaves already-managed uploads in place', () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'ticlaw-workspace-'));
    try {
      const layout = ensureManagedWorkspaceLayout(workspace);
      const upload = path.join(layout.uploads, 'incoming.txt');
      fs.writeFileSync(upload, 'hello');

      const staged = stageManagedWorkspaceArtifact(workspace, upload, 'generated');

      expect(staged.action).toBe('existing');
      expect(staged.relPath).toBe(`${WORKSPACE_UPLOADS_DIR}/incoming.txt`);
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  });
});
