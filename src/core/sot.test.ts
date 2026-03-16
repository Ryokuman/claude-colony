import { describe, it, expect } from 'vitest';

import type { ColonyConfig } from '../config.js';
import { ColonyError } from './errors.js';
import { createSotProvider } from './sot.js';

function baseConfig(overrides: Partial<ColonyConfig> = {}): ColonyConfig {
  return {
    targetRepo: '/tmp/test-repo',
    provider: 'claude',
    language: 'en',
    github: { repo: 'owner/repo', baseBranch: 'main' },
    worktree: { autoClean: false },
    ...overrides,
  };
}

describe('createSotProvider', () => {
  it('should return null when no sot or obsidian is configured', () => {
    const provider = createSotProvider(baseConfig());
    expect(provider).toBeNull();
  });

  it('should create obsidian provider when obsidian config is present', () => {
    const provider = createSotProvider(baseConfig({
      obsidian: { vaultPath: '/tmp/vault' },
      sot: { type: 'obsidian', vaultPath: '/tmp/vault' },
    }));
    expect(provider).not.toBeNull();
    expect(provider!.name).toBe('obsidian');
  });

  it('should auto-map obsidian to sot for backward compat', () => {
    const config = baseConfig({ obsidian: { vaultPath: '/tmp/vault' } });
    // Simulate backward compat: obsidian set but no sot
    const provider = createSotProvider(config);
    expect(provider).not.toBeNull();
    expect(provider!.name).toBe('obsidian');
  });

  it('should create notion stub that throws NOT_IMPLEMENTED', async () => {
    const provider = createSotProvider(baseConfig({ sot: { type: 'notion' } }));
    expect(provider).not.toBeNull();
    expect(provider!.name).toBe('notion');

    await expect(provider!.writeSessionLog('s1', 'content')).rejects.toThrow(ColonyError);
    await expect(provider!.readConventions()).rejects.toThrow('not yet implemented');
  });

  it('should create jira stub that throws NOT_IMPLEMENTED', async () => {
    const provider = createSotProvider(baseConfig({ sot: { type: 'jira' } }));
    expect(provider).not.toBeNull();
    expect(provider!.name).toBe('jira');

    await expect(provider!.writeSessionLog('s1', 'content')).rejects.toThrow(ColonyError);
    await expect(provider!.readConventions()).rejects.toThrow('not yet implemented');
  });

  it('should throw for unknown sot type', () => {
    const config = baseConfig({ sot: { type: 'unknown' as 'obsidian' } });
    expect(() => createSotProvider(config)).toThrow('Unknown SSoT provider type');
  });
});
