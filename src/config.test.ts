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
      taskManager: 'github',
      github: { repo: 'owner/repo' },
      obsidian: { vaultPath: '/tmp/vault', enabled: false },
    };
    await writeFile(path.join(tmpDir, 'colony.config.json'), JSON.stringify(configJson));
    await writeFile(path.join(tmpDir, '.env'), 'GITHUB_TOKEN=test-token\nWEBHOOK_SECRET=secret');

    const config = await loadConfig(tmpDir);

    expect(config.targetRepo).toBe('/tmp/test-repo');
    expect(config.taskManager).toBe('github');
    expect(config.github.repo).toBe('owner/repo');
    expect(config.ports.dashboard).toBe(4000);
    expect(config.ports.webhook).toBe(4001);
    expect(config.githubToken).toBe('test-token');
  });

  it('should throw ConfigError when targetRepo is missing', async () => {
    const configJson = { taskManager: 'github', github: { repo: 'owner/repo' } };
    await writeFile(path.join(tmpDir, 'colony.config.json'), JSON.stringify(configJson));
    await writeFile(path.join(tmpDir, '.env'), 'GITHUB_TOKEN=test-token');

    await expect(loadConfig(tmpDir)).rejects.toThrow(ConfigError);
  });

  it('should throw ConfigError when GITHUB_TOKEN is missing', async () => {
    const configJson = {
      targetRepo: '/tmp/test-repo',
      taskManager: 'github',
      github: { repo: 'owner/repo' },
    };
    await writeFile(path.join(tmpDir, 'colony.config.json'), JSON.stringify(configJson));
    await writeFile(path.join(tmpDir, '.env'), '');

    // Clear env
    delete process.env.GITHUB_TOKEN;

    await expect(loadConfig(tmpDir)).rejects.toThrow(ConfigError);
  });

  it('should use default ports when not specified', async () => {
    const configJson = {
      targetRepo: '/tmp/test-repo',
      taskManager: 'github',
      github: { repo: 'owner/repo' },
    };
    await writeFile(path.join(tmpDir, 'colony.config.json'), JSON.stringify(configJson));
    await writeFile(path.join(tmpDir, '.env'), 'GITHUB_TOKEN=test-token');

    const config = await loadConfig(tmpDir);

    expect(config.ports.dashboard).toBe(4000);
    expect(config.ports.webhook).toBe(4001);
  });

  it('should throw when obsidian enabled without vaultPath', async () => {
    const configJson = {
      targetRepo: '/tmp/test-repo',
      taskManager: 'github',
      github: { repo: 'owner/repo' },
      obsidian: { enabled: true },
    };
    await writeFile(path.join(tmpDir, 'colony.config.json'), JSON.stringify(configJson));
    await writeFile(path.join(tmpDir, '.env'), 'GITHUB_TOKEN=test-token');

    await expect(loadConfig(tmpDir)).rejects.toThrow(ConfigError);
  });
});
