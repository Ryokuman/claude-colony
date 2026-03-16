import { describe, it, expect } from 'vitest';

import type { ColonyConfig } from '../config.js';
import { ColonyError } from './errors.js';
import { createIssueSource } from './issue-source.js';

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

describe('createIssueSource', () => {
  it('should default to github when issueSource is not set', () => {
    const source = createIssueSource(baseConfig());
    expect(source.name).toBe('github');
  });

  it('should create github source when explicitly configured', () => {
    const source = createIssueSource(baseConfig({ issueSource: { type: 'github' } }));
    expect(source.name).toBe('github');
  });

  it('should create jira stub that throws NOT_IMPLEMENTED', async () => {
    const source = createIssueSource(baseConfig({ issueSource: { type: 'jira' } }));
    expect(source.name).toBe('jira');

    await expect(source.getIssue('TEST-1')).rejects.toThrow(ColonyError);
    await expect(source.listIssues()).rejects.toThrow('not yet implemented');
    await expect(source.setStatus('1', 'open')).rejects.toThrow('not yet implemented');
  });

  it('should create notion stub that throws NOT_IMPLEMENTED', async () => {
    const source = createIssueSource(baseConfig({ issueSource: { type: 'notion' } }));
    expect(source.name).toBe('notion');

    await expect(source.getIssue('abc')).rejects.toThrow(ColonyError);
    await expect(source.listIssues()).rejects.toThrow('not yet implemented');
    await expect(source.setStatus('1', 'open')).rejects.toThrow('not yet implemented');
  });

  it('should throw for unknown issue source type', () => {
    const config = baseConfig({ issueSource: { type: 'unknown' as 'github' } });
    expect(() => createIssueSource(config)).toThrow('Unknown issue source type');
  });
});
