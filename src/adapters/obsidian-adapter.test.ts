import { access, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import {
  IssueStatus,
} from '../core/issue-status.js';
import { ObsidianAdapter } from './obsidian-adapter.js';

// ---------------------------------------------------------------------------
// Issue CRUD
// ---------------------------------------------------------------------------

describe('ObsidianAdapter', () => {
  let tmpDir: string;
  let adapter: ObsidianAdapter;

  beforeEach(async () => {
    tmpDir = path.join(os.tmpdir(), `agent-hive-obsidian-test-${Date.now()}`);
    await mkdir(path.join(tmpDir, 'issues'), { recursive: true });
    adapter = new ObsidianAdapter({ vaultPath: tmpDir });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('creates and gets an issue', async () => {
    const issue = await adapter.create({ title: 'Test issue', body: 'Test body' });

    expect(issue.number).toBe(1);
    expect(issue.title).toBe('Test issue');
    expect(issue.body).toBe('Test body');
    expect(issue.state).toBe('open');

    const fetched = await adapter.get('1');
    expect(fetched.title).toBe('Test issue');
    expect(fetched.body).toBe('Test body');
  });

  it('lists issues', async () => {
    await adapter.create({ title: 'First', body: 'body1' });
    await adapter.create({ title: 'Second', body: 'body2' });

    const all = await adapter.list();
    expect(all).toHaveLength(2);
  });

  it('filters list by state', async () => {
    await adapter.create({ title: 'Open one', body: '' });
    const toClose = await adapter.create({ title: 'To close', body: '' });
    await adapter.close(String(toClose.number));

    const openOnly = await adapter.list({ state: 'open' });
    expect(openOnly).toHaveLength(1);
    expect(openOnly[0].title).toBe('Open one');

    const closedOnly = await adapter.list({ state: 'closed' });
    expect(closedOnly).toHaveLength(1);
    expect(closedOnly[0].title).toBe('To close');
  });

  it('filters list by labels', async () => {
    await adapter.create({ title: 'Bug', body: '', labels: ['bug'] });
    await adapter.create({ title: 'Feature', body: '', labels: ['feature'] });

    const bugs = await adapter.list({ labels: ['bug'] });
    expect(bugs).toHaveLength(1);
    expect(bugs[0].title).toBe('Bug');
  });

  it('respects list limit', async () => {
    await adapter.create({ title: 'A', body: '' });
    await adapter.create({ title: 'B', body: '' });
    await adapter.create({ title: 'C', body: '' });

    const limited = await adapter.list({ limit: 2 });
    expect(limited).toHaveLength(2);
  });

  it('updates an issue', async () => {
    await adapter.create({ title: 'Original', body: 'body' });
    const updated = await adapter.update('1', { title: 'Updated' });

    expect(updated.title).toBe('Updated');
    expect(updated.body).toBe('body');
  });

  it('manages labels', async () => {
    await adapter.create({ title: 'Labeled', body: '' });

    await adapter.addLabel('1', 'bug');
    await adapter.addLabel('1', 'urgent');
    let issue = await adapter.get('1');
    expect(issue.labels).toEqual(['bug', 'urgent']);

    await adapter.removeLabel('1', 'bug');
    issue = await adapter.get('1');
    expect(issue.labels).toEqual(['urgent']);
  });

  it('closes an issue', async () => {
    await adapter.create({ title: 'To close', body: '' });
    await adapter.close('1');

    const issue = await adapter.get('1');
    expect(issue.state).toBe('closed');
  });

  it('throws on non-existent issue', async () => {
    await expect(adapter.get('999')).rejects.toThrow('Obsidian issue not found: 999');
  });

  it('persists as markdown files with frontmatter', async () => {
    await adapter.create({ title: 'Persisted', body: 'Some content', labels: ['test'] });

    const filePath = path.join(tmpDir, 'issues', '1.md');
    const content = await readFile(filePath, 'utf-8');

    expect(content).toContain('title: Persisted');
    expect(content).toContain('state: open');
    expect(content).toContain('labels: test');
    expect(content).toContain('Some content');
  });

  it('auto-increments issue numbers', async () => {
    const first = await adapter.create({ title: 'First', body: '' });
    const second = await adapter.create({ title: 'Second', body: '' });

    expect(first.number).toBe(1);
    expect(second.number).toBe(2);
  });

  it('reads pre-existing markdown issue files', async () => {
    const issueContent = [
      '---',
      'title: Legacy Issue',
      'number: 42',
      'state: open',
      'labels: legacy, imported',
      '---',
      'This was created outside the adapter.',
    ].join('\n');

    await writeFile(path.join(tmpDir, 'issues', '42.md'), issueContent, 'utf-8');

    const issue = await adapter.get('42');
    expect(issue.title).toBe('Legacy Issue');
    expect(issue.number).toBe(42);
    expect(issue.labels).toEqual(['legacy', 'imported']);
    expect(issue.body).toBe('This was created outside the adapter.');
  });

  it('uses custom issueFolder', async () => {
    const customDir = path.join(tmpDir, 'tasks');
    await mkdir(customDir, { recursive: true });

    const customAdapter = new ObsidianAdapter({ vaultPath: tmpDir, issueFolder: 'tasks' });
    const issue = await customAdapter.create({ title: 'Custom folder', body: 'test' });

    expect(issue.number).toBe(1);
    const fetched = await customAdapter.get('1');
    expect(fetched.title).toBe('Custom folder');
  });
});

// ---------------------------------------------------------------------------
// Vault initialisation (migrated from src/obsidian/vault-init.test.ts)
// ---------------------------------------------------------------------------

describe('ObsidianAdapter.initVault', () => {
  let tmpDir: string;
  let adapter: ObsidianAdapter;

  beforeEach(async () => {
    tmpDir = path.join(os.tmpdir(), `agent-hive-vault-test-${Date.now()}`);
    await mkdir(tmpDir, { recursive: true });
    adapter = new ObsidianAdapter({ vaultPath: tmpDir });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('should create vault directory structure', async () => {
    await adapter.initVault();

    await expect(access(path.join(tmpDir, 'spec'))).resolves.toBeUndefined();
    await expect(access(path.join(tmpDir, 'context'))).resolves.toBeUndefined();
    await expect(access(path.join(tmpDir, 'sessions'))).resolves.toBeUndefined();
  });

  it('should create default CLAUDE.md', async () => {
    await adapter.initVault();

    const content = await readFile(path.join(tmpDir, 'context', 'CLAUDE.md'), 'utf-8');
    expect(content).toContain('프로젝트 컨벤션 및 패턴');
    expect(content).toContain('SSoT');
  });

  it('should not overwrite existing CLAUDE.md', async () => {
    await mkdir(path.join(tmpDir, 'context'), { recursive: true });
    await writeFile(path.join(tmpDir, 'context', 'CLAUDE.md'), 'custom content');

    await adapter.initVault();

    const content = await readFile(path.join(tmpDir, 'context', 'CLAUDE.md'), 'utf-8');
    expect(content).toBe('custom content');
  });
});

// ---------------------------------------------------------------------------
// Session logging
// ---------------------------------------------------------------------------

describe('ObsidianAdapter session logging', () => {
  let tmpDir: string;
  let adapter: ObsidianAdapter;

  beforeEach(async () => {
    tmpDir = path.join(os.tmpdir(), `agent-hive-session-test-${Date.now()}`);
    await mkdir(tmpDir, { recursive: true });
    adapter = new ObsidianAdapter({ vaultPath: tmpDir });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('creates a session log file with header', async () => {
    const logPath = await adapter.createSessionLog({
      role: 'worker',
      branch: 'feat/test',
      issueNumber: 42,
    });

    expect(logPath).toContain('sessions');
    expect(logPath).toContain('worker-feat-test-');

    const content = await readFile(logPath, 'utf-8');
    expect(content).toContain('worker 세션 기록서');
    expect(content).toContain('feat/test');
    expect(content).toContain('#42');
  });

  it('creates a session log with PR number', async () => {
    const logPath = await adapter.createSessionLog({
      role: 'reviewer',
      branch: 'feat/review',
      prNumber: 10,
    });

    const content = await readFile(logPath, 'utf-8');
    expect(content).toContain('reviewer 세션 기록서');
    expect(content).toContain('#10');
  });

  it('appends timestamped content to log', async () => {
    const logPath = await adapter.createSessionLog({
      role: 'worker',
      branch: 'feat/append',
    });

    await adapter.appendToLog(logPath, 'some content');

    const content = await readFile(logPath, 'utf-8');
    expect(content).toMatch(/`\d{2}:\d{2}:\d{2}`/);
    expect(content).toContain('some content');
  });

  it('appends decision entry', async () => {
    const logPath = await adapter.createSessionLog({
      role: 'worker',
      branch: 'feat/decision',
    });

    await adapter.appendDecision(logPath, 'Use ESM modules');

    const content = await readFile(logPath, 'utf-8');
    expect(content).toContain('**[DECISION]**');
    expect(content).toContain('Use ESM modules');
  });

  it('appends SSoT candidate', async () => {
    const logPath = await adapter.createSessionLog({
      role: 'worker',
      branch: 'feat/ssot',
    });

    await adapter.appendSotCandidate(logPath, 'Important pattern');

    const content = await readFile(logPath, 'utf-8');
    expect(content).toContain('**[SSoT]**');
    expect(content).toContain('Important pattern');
  });

  it('appends blocker entry', async () => {
    const logPath = await adapter.createSessionLog({
      role: 'worker',
      branch: 'feat/blocker',
    });

    await adapter.appendBlocker(logPath, 'Missing dependency', 99);

    const content = await readFile(logPath, 'utf-8');
    expect(content).toContain('**[BLOCKER]**');
    expect(content).toContain('Missing dependency');
    expect(content).toContain('Issue #99');
  });

  it('closes session log with summary', async () => {
    const logPath = await adapter.createSessionLog({
      role: 'worker',
      branch: 'feat/close',
    });

    await adapter.closeSessionLog(logPath, 'Work completed successfully');

    const content = await readFile(logPath, 'utf-8');
    expect(content).toContain('세션 종료 요약');
    expect(content).toContain('Work completed successfully');
    expect(content).toContain('종료 시각');
  });
});

// ---------------------------------------------------------------------------
// Spec sync
// ---------------------------------------------------------------------------

describe('ObsidianAdapter spec sync', () => {
  let tmpDir: string;
  let adapter: ObsidianAdapter;

  beforeEach(async () => {
    tmpDir = path.join(os.tmpdir(), `agent-hive-sot-test-${Date.now()}`);
    await mkdir(tmpDir, { recursive: true });
    adapter = new ObsidianAdapter({ vaultPath: tmpDir });
    await adapter.initVault();
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('syncs new spec document', async () => {
    await adapter.syncToSpec('Architecture', 'Modular design with adapters');

    const specPath = path.join(tmpDir, 'spec', 'architecture.md');
    const content = await readFile(specPath, 'utf-8');
    expect(content).toContain('# Architecture');
    expect(content).toContain('Modular design with adapters');
  });

  it('appends to existing spec document', async () => {
    await adapter.syncToSpec('Architecture', 'Initial content');
    await adapter.syncToSpec('Architecture', 'Updated content');

    const specPath = path.join(tmpDir, 'spec', 'architecture.md');
    const content = await readFile(specPath, 'utf-8');
    expect(content).toContain('Initial content');
    expect(content).toContain('Updated content');
    expect(content).toContain('업데이트');
  });
});

// ---------------------------------------------------------------------------
// StatusMapping integration (obsidian adapter + issue-status)
// ---------------------------------------------------------------------------

describe('ObsidianAdapter statusMapping integration', () => {
  let tmpDir: string;
  let adapter: ObsidianAdapter;

  beforeEach(async () => {
    tmpDir = path.join(os.tmpdir(), `agent-hive-obsidian-status-test-${Date.now()}`);
    await mkdir(path.join(tmpDir, 'issues'), { recursive: true });
    adapter = new ObsidianAdapter({ vaultPath: tmpDir });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('sets issue status to in-progress using default obsidian mapping', async () => {
    await adapter.create({ title: 'Status test', body: '' });

    await adapter.setStatus('1', IssueStatus.InProgress);

    const issue = await adapter.get('1');
    expect(issue.labels).toContain('in-progress');
  });

  it('sets issue status to reviewing', async () => {
    await adapter.create({ title: 'Review test', body: '' });

    await adapter.setStatus('1', IssueStatus.InReview);

    const issue = await adapter.get('1');
    expect(issue.labels).toContain('reviewing');
    expect(issue.labels).not.toContain('in-progress');
  });

  it('sets issue status to waiting-merge', async () => {
    await adapter.create({ title: 'Merge test', body: '' });

    await adapter.setStatus('1', IssueStatus.AwaitingMerge);

    const issue = await adapter.get('1');
    expect(issue.labels).toContain('waiting-merge');
  });

  it('transitions between statuses and removes old labels', async () => {
    await adapter.create({ title: 'Transition test', body: '' });

    await adapter.setStatus('1', IssueStatus.InProgress);
    let issue = await adapter.get('1');
    expect(issue.labels).toContain('in-progress');

    await adapter.setStatus('1', IssueStatus.InReview);
    issue = await adapter.get('1');
    expect(issue.labels).toContain('reviewing');
    expect(issue.labels).not.toContain('in-progress');

    await adapter.setStatus('1', IssueStatus.AwaitingMerge);
    issue = await adapter.get('1');
    expect(issue.labels).toContain('waiting-merge');
    expect(issue.labels).not.toContain('reviewing');
    expect(issue.labels).not.toContain('in-progress');
  });

  it('rejects setting status to todo or done directly', async () => {
    await adapter.create({ title: 'Reject test', body: '' });

    await expect(
      adapter.setStatus('1', IssueStatus.Pending),
    ).rejects.toThrow('Cannot set status to todo directly');

    await expect(
      adapter.setStatus('1', IssueStatus.Completed),
    ).rejects.toThrow('Cannot set status to done directly');
  });

  it('deriveStatus derives status from labels', async () => {
    await adapter.create({ title: 'Derive test', body: '' });
    await adapter.addLabel('1', 'in-progress');

    const issue = await adapter.get('1');
    expect(adapter.deriveStatus(issue)).toBe('in-progress');
    expect(issue.title).toBe('Derive test');
  });

  it('deriveStatus returns todo for open issue without status labels', async () => {
    await adapter.create({ title: 'No labels', body: '' });

    const issue = await adapter.get('1');
    expect(adapter.deriveStatus(issue)).toBe('todo');
  });

  it('deriveStatus returns done for closed issue', async () => {
    await adapter.create({ title: 'Closed', body: '' });
    await adapter.close('1');

    const issue = await adapter.get('1');
    expect(adapter.deriveStatus(issue)).toBe('done');
  });

  it('listByStatus returns issues with managed labels', async () => {
    await adapter.create({ title: 'Active', body: '' });
    await adapter.addLabel('1', 'in-progress');
    await adapter.create({ title: 'Idle', body: '' });

    const statuses = await adapter.listByStatus([
      IssueStatus.InProgress,
      IssueStatus.InReview,
      IssueStatus.AwaitingMerge,
    ]);
    expect(statuses).toHaveLength(1);
    expect(statuses[0].title).toBe('Active');
    expect(statuses[0].status).toBe('in-progress');
  });

  it('works with custom statusMapping overrides', async () => {
    const customAdapter = new ObsidianAdapter(
      { vaultPath: tmpDir },
      { 'in-progress': 'working', reviewing: 'under-review' },
    );

    await adapter.create({ title: 'Custom status', body: '' });

    await customAdapter.setStatus('1', IssueStatus.InProgress);
    let issue = await adapter.get('1');
    expect(issue.labels).toContain('working');
    expect(issue.labels).not.toContain('in-progress');

    await customAdapter.setStatus('1', IssueStatus.InReview);
    issue = await adapter.get('1');
    expect(issue.labels).toContain('under-review');
    expect(issue.labels).not.toContain('working');
  });
});
