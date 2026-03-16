import { mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { loadConfig, ConfigError } from './config.js';

describe('config', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = path.join(os.tmpdir(), `hive-test-config-${Date.now()}`);
    await mkdir(tmpDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('should load a valid config', async () => {
    const configJson = {
      targetRepo: '/tmp/test-repo',
      github: { repo: 'owner/repo' },
    };
    await writeFile(path.join(tmpDir, 'hive.config.json'), JSON.stringify(configJson));

    const config = await loadConfig(tmpDir);

    expect(config.targetRepo).toBe('/tmp/test-repo');
    expect(config.provider).toBe('claude');
    expect(config.github.repo).toBe('owner/repo');
    expect(config.github.baseBranch).toBe('main');
    expect(config.obsidian).toBeUndefined();
  });

  it('should throw ConfigError when targetRepo is missing', async () => {
    const configJson = { github: { repo: 'owner/repo' } };
    await writeFile(path.join(tmpDir, 'hive.config.json'), JSON.stringify(configJson));

    await expect(loadConfig(tmpDir)).rejects.toThrow(ConfigError);
  });

  it('should throw ConfigError when github.repo is missing', async () => {
    const configJson = { targetRepo: '/tmp/test-repo' };
    await writeFile(path.join(tmpDir, 'hive.config.json'), JSON.stringify(configJson));

    await expect(loadConfig(tmpDir)).rejects.toThrow(ConfigError);
  });

  it('should load config with obsidian', async () => {
    const configJson = {
      targetRepo: '/tmp/test-repo',
      github: { repo: 'owner/repo' },
      obsidian: { vaultPath: '/tmp/vault' },
    };
    await writeFile(path.join(tmpDir, 'hive.config.json'), JSON.stringify(configJson));

    const config = await loadConfig(tmpDir);

    expect(config.obsidian).toBeDefined();
    expect(config.obsidian?.vaultPath).toBe('/tmp/vault');
  });

  it('should default obsidian to undefined when not configured', async () => {
    const configJson = {
      targetRepo: '/tmp/test-repo',
      github: { repo: 'owner/repo' },
    };
    await writeFile(path.join(tmpDir, 'hive.config.json'), JSON.stringify(configJson));

    const config = await loadConfig(tmpDir);

    expect(config.obsidian).toBeUndefined();
  });

  it('should load config with permissions', async () => {
    const configJson = {
      targetRepo: '/tmp/test-repo',
      github: { repo: 'owner/repo' },
      permissions: { allow: ['Bash(npm:*)', 'Bash(git:*)'] },
    };
    await writeFile(path.join(tmpDir, 'hive.config.json'), JSON.stringify(configJson));

    const config = await loadConfig(tmpDir);

    expect(config.permissions?.allow).toEqual(['Bash(npm:*)', 'Bash(git:*)']);
  });

  it('should default permissions to undefined when not configured', async () => {
    const configJson = {
      targetRepo: '/tmp/test-repo',
      github: { repo: 'owner/repo' },
    };
    await writeFile(path.join(tmpDir, 'hive.config.json'), JSON.stringify(configJson));

    const config = await loadConfig(tmpDir);

    expect(config.permissions).toBeUndefined();
  });
});
