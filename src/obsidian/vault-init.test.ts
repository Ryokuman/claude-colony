import { mkdir, rm, access, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import type { ColonyConfig } from '../config.js';
import { initVault } from './vault-init.js';

function createBaseConfig(): ColonyConfig {
  return {
    targetRepo: '/tmp/test-repo',
    provider: 'claude',
    language: 'en',
    github: { repo: 'owner/repo', baseBranch: 'main' },
    worktree: { autoClean: false },
  };
}

describe('vault-init', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = path.join(os.tmpdir(), `colony-test-vault-${Date.now()}`);
    await mkdir(tmpDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('should create vault directory structure', async () => {
    const config: ColonyConfig = { ...createBaseConfig(), obsidian: { vaultPath: tmpDir } };
    await initVault(config);

    await expect(access(path.join(tmpDir, 'spec'))).resolves.toBeUndefined();
    await expect(access(path.join(tmpDir, 'context'))).resolves.toBeUndefined();
    await expect(access(path.join(tmpDir, 'sessions'))).resolves.toBeUndefined();
  });

  it('should create default CLAUDE.md', async () => {
    const config: ColonyConfig = { ...createBaseConfig(), obsidian: { vaultPath: tmpDir } };
    await initVault(config);

    const content = await readFile(path.join(tmpDir, 'context', 'CLAUDE.md'), 'utf-8');
    expect(content).toContain('프로젝트 컨벤션 및 패턴');
    expect(content).toContain('SSoT');
  });

  it('should skip when obsidian is not configured', async () => {
    const config = createBaseConfig();
    await initVault(config);

    await expect(access(path.join(tmpDir, 'spec'))).rejects.toThrow();
  });

  it('should not overwrite existing CLAUDE.md', async () => {
    const config: ColonyConfig = { ...createBaseConfig(), obsidian: { vaultPath: tmpDir } };

    await mkdir(path.join(tmpDir, 'context'), { recursive: true });
    await import('node:fs/promises').then((fs) =>
      fs.writeFile(path.join(tmpDir, 'context', 'CLAUDE.md'), 'custom content'),
    );

    await initVault(config);

    const content = await readFile(path.join(tmpDir, 'context', 'CLAUDE.md'), 'utf-8');
    expect(content).toBe('custom content');
  });
});
