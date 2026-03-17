import { mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { loadConfig, ConfigError } from './config.js';

describe('config', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = path.join(os.tmpdir(), `colony-test-config-${Date.now()}`);
    await mkdir(tmpDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('should load a valid config', async () => {
    const configJson = {
      targetRepo: '/tmp/test-repo',
      github: { repo: 'owner/repo' },
      adapter: { type: 'github' },
    };
    await writeFile(path.join(tmpDir, 'ah.config.json'), JSON.stringify(configJson));

    const config = await loadConfig(tmpDir);

    expect(config.targetRepo).toBe('/tmp/test-repo');
    expect(config.provider).toBe('claude');
    expect(config.language).toBe('en');
    expect(config.github.repo).toBe('owner/repo');
    expect(config.github.baseBranch).toBe('main');
    expect(config.adapter.type).toBe('github');
    expect(config.adapter.github?.repo).toBe('owner/repo');
    expect(config.obsidian).toBeUndefined();
  });

  it('should throw ConfigError when targetRepo is missing', async () => {
    const configJson = { github: { repo: 'owner/repo' }, adapter: { type: 'github' } };
    await writeFile(path.join(tmpDir, 'ah.config.json'), JSON.stringify(configJson));

    await expect(loadConfig(tmpDir)).rejects.toThrow(ConfigError);
  });

  it('should throw ConfigError when github.repo is missing', async () => {
    const configJson = { targetRepo: '/tmp/test-repo', adapter: { type: 'github' } };
    await writeFile(path.join(tmpDir, 'ah.config.json'), JSON.stringify(configJson));

    await expect(loadConfig(tmpDir)).rejects.toThrow(ConfigError);
  });

  it('should throw ConfigError when adapter.type is missing', async () => {
    const configJson = { targetRepo: '/tmp/test-repo', github: { repo: 'owner/repo' } };
    await writeFile(path.join(tmpDir, 'ah.config.json'), JSON.stringify(configJson));

    await expect(loadConfig(tmpDir)).rejects.toThrow(ConfigError);
  });

  it('should force github adapter to use config.github values', async () => {
    const configJson = {
      targetRepo: '/tmp/test-repo',
      github: { repo: 'owner/repo', baseBranch: 'develop' },
      adapter: { type: 'github', github: { repo: 'other/repo' } },
    };
    await writeFile(path.join(tmpDir, 'ah.config.json'), JSON.stringify(configJson));

    const config = await loadConfig(tmpDir);

    expect(config.adapter.github?.repo).toBe('owner/repo');
    expect(config.adapter.github?.baseBranch).toBe('develop');
  });

  it('should load config with obsidian', async () => {
    const configJson = {
      targetRepo: '/tmp/test-repo',
      github: { repo: 'owner/repo' },
      adapter: { type: 'github' },
      obsidian: { vaultPath: '/tmp/vault' },
    };
    await writeFile(path.join(tmpDir, 'ah.config.json'), JSON.stringify(configJson));

    const config = await loadConfig(tmpDir);

    expect(config.obsidian?.vaultPath).toBe('/tmp/vault');
  });

  it('should load config with custom language', async () => {
    const configJson = {
      targetRepo: '/tmp/test-repo',
      github: { repo: 'owner/repo' },
      adapter: { type: 'github' },
      language: 'ko',
    };
    await writeFile(path.join(tmpDir, 'ah.config.json'), JSON.stringify(configJson));

    const config = await loadConfig(tmpDir);

    expect(config.language).toBe('ko');
  });

  it('should throw when obsidian configured without vaultPath', async () => {
    const configJson = {
      targetRepo: '/tmp/test-repo',
      github: { repo: 'owner/repo' },
      adapter: { type: 'github' },
      obsidian: {},
    };
    await writeFile(path.join(tmpDir, 'ah.config.json'), JSON.stringify(configJson));

    await expect(loadConfig(tmpDir)).rejects.toThrow(ConfigError);
  });
});
