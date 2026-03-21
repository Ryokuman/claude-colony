import { describe, it, expect, vi, beforeEach } from 'vitest';

import type { AdapterConfig, Issue, IssueAdapter, StatusMapping } from '../../../src/adapters/types.js';

import { ConfigError } from '../../../src/core/errors.js';

import {
  resolveStatusMapping,
  getIssueStatus,
  getAllIssueStatuses,
  setIssueStatus,
  IssueStatus,
  TRANSITION_STATUSES,
  DEFAULT_STATUS_MAPPINGS,
  findStatusKey,
} from '../../../src/core/issue-status.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeIssue(overrides: Partial<Issue> = {}): Issue {
  return {
    id: '1',
    number: 1,
    title: 'Test issue',
    body: '',
    state: 'open',
    labels: [],
    url: 'https://example.com/1',
    ...overrides,
  };
}

function createMockAdapter(
  type: string,
  issues: Issue[],
  mapping?: StatusMapping,
): IssueAdapter {
  const resolvedMapping = mapping ?? DEFAULT_STATUS_MAPPINGS[type] ?? DEFAULT_STATUS_MAPPINGS.local;

  return {
    type,
    get: vi.fn(async (ref: string) => {
      const found = issues.find((i) => String(i.number) === ref);
      if (!found) throw new Error(`Issue ${ref} not found`);
      return found;
    }),
    list: vi.fn(async () => issues),
    create: vi.fn(async () => issues[0]!),
    update: vi.fn(async () => issues[0]!),
    addLabel: vi.fn(async () => {}),
    removeLabel: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
    deriveStatus: vi.fn((issue: Issue) => {
      if (issue.state === 'closed') return IssueStatus.Completed;
      if (type === 'jira' && issue.platformStatus) {
        const status = findStatusKey(resolvedMapping, issue.platformStatus);
        if (status) return status;
        return IssueStatus.Pending;
      }
      for (const label of issue.labels) {
        const status = findStatusKey(resolvedMapping, label);
        if (status && TRANSITION_STATUSES.includes(status)) return status;
      }
      return IssueStatus.Pending;
    }),
    setStatus: vi.fn(async (_ref: string, status: string) => {
      if (status === IssueStatus.Pending || status === IssueStatus.Completed) {
        throw new Error(`Cannot set status to ${status} directly`);
      }
    }),
    listByStatus: vi.fn(async (statuses: string[]) => {
      return issues
        .map((issue) => {
          let derivedStatus: string;
          if (issue.state === 'closed') {
            derivedStatus = IssueStatus.Completed;
          } else if (type === 'jira' && issue.platformStatus) {
            const s = findStatusKey(resolvedMapping, issue.platformStatus);
            derivedStatus = s ?? IssueStatus.Pending;
          } else {
            derivedStatus = IssueStatus.Pending;
            for (const label of issue.labels) {
              const s = findStatusKey(resolvedMapping, label);
              if (s && TRANSITION_STATUSES.includes(s)) {
                derivedStatus = s;
                break;
              }
            }
          }
          return {
            number: issue.number,
            title: issue.title,
            status: derivedStatus as import('./issue-status.js').IssueStatus,
            url: issue.url,
          };
        })
        .filter((info) => statuses.includes(info.status));
    }),
  };
}

function githubConfig(overrides?: Partial<AdapterConfig>): AdapterConfig {
  return { type: 'github', github: { repo: 'owner/repo' }, ...overrides };
}

function jiraConfig(overrides?: Partial<AdapterConfig>): AdapterConfig {
  return {
    type: 'jira',
    jira: { host: 'https://jira.example.com', projectKey: 'TEST', email: 'a@b.com' },
    ...overrides,
  };
}

function localConfig(overrides?: Partial<AdapterConfig>): AdapterConfig {
  return { type: 'local', ...overrides };
}

function obsidianConfig(overrides?: Partial<AdapterConfig>): AdapterConfig {
  return { type: 'obsidian', obsidian: { vaultPath: '/tmp/vault' }, ...overrides };
}

// ---------------------------------------------------------------------------
// resolveStatusMapping
// ---------------------------------------------------------------------------

describe('resolveStatusMapping', () => {
  it('returns default mapping for adapter type', () => {
    const mapping = resolveStatusMapping(githubConfig());
    expect(mapping).toEqual(DEFAULT_STATUS_MAPPINGS.github);
  });

  it('merges user overrides onto defaults', () => {
    const config = githubConfig({ statusMapping: { 'in-progress': 'wip' } });
    const mapping = resolveStatusMapping(config);
    expect(mapping['in-progress']).toBe('wip');
    // Other keys should retain their defaults
    expect(mapping.reviewing).toBe(DEFAULT_STATUS_MAPPINGS.github.reviewing);
  });

  it('falls back to local defaults for unknown adapter type', () => {
    const config = { type: 'unknown' as AdapterConfig['type'] };
    const mapping = resolveStatusMapping(config);
    expect(mapping).toEqual(DEFAULT_STATUS_MAPPINGS.local);
  });

  it('throws ConfigError when user override creates duplicate values', () => {
    // 'in-progress' default for github is 'in-progress', 'reviewing' default is 'in-review'
    // Setting 'reviewing' to 'in-progress' creates a duplicate
    expect(() =>
      resolveStatusMapping(githubConfig({ statusMapping: { reviewing: 'in-progress' } })),
    ).toThrow(ConfigError);
  });

  it('includes both conflicting keys in the error message', () => {
    expect(() =>
      resolveStatusMapping(githubConfig({ statusMapping: { reviewing: 'in-progress' } })),
    ).toThrow(/in-progress.*reviewing|reviewing.*in-progress/);
  });

  it('detects duplicates case-insensitively', () => {
    expect(() =>
      resolveStatusMapping(jiraConfig({ statusMapping: { reviewing: 'In Progress' } })),
    ).toThrow(ConfigError);
  });
});

// ---------------------------------------------------------------------------
// deriveStatus via getIssueStatus
// ---------------------------------------------------------------------------

describe('getIssueStatus — Jira branch', () => {
  it('maps platformStatus "In Progress" to in-progress', async () => {
    const issue = makeIssue({ platformStatus: 'In Progress' });
    const adapter = createMockAdapter('jira', [issue]);
    const result = await getIssueStatus(adapter, 1);
    expect(result.status).toBe(IssueStatus.InProgress);
  });

  it('maps platformStatus case-insensitively ("REVIEWING" → reviewing)', async () => {
    const issue = makeIssue({ platformStatus: 'REVIEWING' });
    const adapter = createMockAdapter('jira', [issue]);
    const result = await getIssueStatus(adapter, 1);
    expect(result.status).toBe(IssueStatus.InReview);
  });

  it('falls back to todo for unknown platformStatus', async () => {
    const issue = makeIssue({ platformStatus: 'Unknown Status' });
    const adapter = createMockAdapter('jira', [issue]);
    const result = await getIssueStatus(adapter, 1);
    expect(result.status).toBe(IssueStatus.Pending);
  });

  it('returns done when state is closed regardless of platformStatus', async () => {
    const issue = makeIssue({ state: 'closed', platformStatus: 'In Progress' });
    const adapter = createMockAdapter('jira', [issue]);
    const result = await getIssueStatus(adapter, 1);
    expect(result.status).toBe(IssueStatus.Completed);
  });
});

describe('getIssueStatus — GitHub branch', () => {
  it('derives in-progress from label', async () => {
    const issue = makeIssue({ labels: ['in-progress'] });
    const adapter = createMockAdapter('github', [issue]);
    const result = await getIssueStatus(adapter, 1);
    expect(result.status).toBe(IssueStatus.InProgress);
  });

  it('returns todo when labels are empty', async () => {
    const issue = makeIssue({ labels: [] });
    const adapter = createMockAdapter('github', [issue]);
    const result = await getIssueStatus(adapter, 1);
    expect(result.status).toBe(IssueStatus.Pending);
  });

  it('returns done when state is closed', async () => {
    const issue = makeIssue({ state: 'closed', labels: ['in-progress'] });
    const adapter = createMockAdapter('github', [issue]);
    const result = await getIssueStatus(adapter, 1);
    expect(result.status).toBe(IssueStatus.Completed);
  });
});

describe('getIssueStatus — Obsidian/Local branch', () => {
  it('derives status from label for obsidian', async () => {
    const issue = makeIssue({ labels: ['in-progress'] });
    const adapter = createMockAdapter('obsidian', [issue]);
    const result = await getIssueStatus(adapter, 1);
    expect(result.status).toBe(IssueStatus.InProgress);
  });

  it('derives status from label for local', async () => {
    const issue = makeIssue({ labels: ['reviewing'] });
    const adapter = createMockAdapter('local', [issue]);
    const result = await getIssueStatus(adapter, 1);
    expect(result.status).toBe(IssueStatus.InReview);
  });

  it('returns todo when labels are empty', async () => {
    const issue = makeIssue({ labels: [] });
    const adapter = createMockAdapter('local', [issue]);
    const result = await getIssueStatus(adapter, 1);
    expect(result.status).toBe(IssueStatus.Pending);
  });
});

// ---------------------------------------------------------------------------
// getAllIssueStatuses
// ---------------------------------------------------------------------------

describe('getAllIssueStatuses', () => {
  it('delegates to adapter.listByStatus for Jira', async () => {
    const issues = [makeIssue({ platformStatus: 'In Progress' })];
    const adapter = createMockAdapter('jira', issues);
    await getAllIssueStatuses(adapter);

    expect(adapter.listByStatus).toHaveBeenCalledWith(TRANSITION_STATUSES);
  });

  it('delegates to adapter.listByStatus for GitHub', async () => {
    const issues = [makeIssue({ labels: ['in-progress'] })];
    const adapter = createMockAdapter('github', issues);
    await getAllIssueStatuses(adapter);

    expect(adapter.listByStatus).toHaveBeenCalledWith(TRANSITION_STATUSES);
  });

  it('returns mapped statuses for all issues', async () => {
    const issues = [
      makeIssue({ number: 1, labels: ['in-progress'] }),
      makeIssue({ number: 2, labels: ['in-review'] }),
    ];
    const adapter = createMockAdapter('github', issues);
    const results = await getAllIssueStatuses(adapter);

    expect(results).toHaveLength(2);
    expect(results[0].status).toBe(IssueStatus.InProgress);
    expect(results[1].status).toBe(IssueStatus.InReview);
  });
});

// ---------------------------------------------------------------------------
// setIssueStatus
// ---------------------------------------------------------------------------

describe('setIssueStatus', () => {
  it('throws when setting status to todo or done directly', async () => {
    const adapter = createMockAdapter('github', [makeIssue()]);
    await expect(setIssueStatus(adapter, 1, IssueStatus.Pending)).rejects.toThrow(
      'Cannot set status to todo directly',
    );
    await expect(
      setIssueStatus(adapter, 1, IssueStatus.Completed),
    ).rejects.toThrow('Cannot set status to done directly');
  });

  describe('GitHub', () => {
    let adapter: ReturnType<typeof createMockAdapter>;

    beforeEach(() => {
      adapter = createMockAdapter('github', [makeIssue()]);
    });

    it('delegates to adapter.setStatus', async () => {
      await setIssueStatus(adapter, 1, IssueStatus.InProgress);
      expect(adapter.setStatus).toHaveBeenCalledWith('1', IssueStatus.InProgress);
    });
  });

  describe('Jira', () => {
    let adapter: ReturnType<typeof createMockAdapter>;

    beforeEach(() => {
      adapter = createMockAdapter('jira', [makeIssue()]);
    });

    it('delegates to adapter.setStatus for in-progress', async () => {
      await setIssueStatus(adapter, 1, IssueStatus.InProgress);
      expect(adapter.setStatus).toHaveBeenCalledWith('1', IssueStatus.InProgress);
    });

    it('delegates to adapter.setStatus for reviewing', async () => {
      await setIssueStatus(adapter, 1, IssueStatus.InReview);
      expect(adapter.setStatus).toHaveBeenCalledWith('1', IssueStatus.InReview);
    });
  });

  describe('Obsidian/Local', () => {
    let adapter: ReturnType<typeof createMockAdapter>;

    beforeEach(() => {
      adapter = createMockAdapter('local', [makeIssue()]);
    });

    it('delegates to adapter.setStatus', async () => {
      await setIssueStatus(adapter, 1, IssueStatus.InReview);
      expect(adapter.setStatus).toHaveBeenCalledWith('1', IssueStatus.InReview);
    });
  });
});
