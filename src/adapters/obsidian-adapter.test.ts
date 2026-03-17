import { access, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { ObsidianAdapter, extractSotCandidates } from './obsidian-adapter.js';

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
// SSoT extraction (migrated from src/obsidian/sot-sync.test.ts)
// ---------------------------------------------------------------------------

describe('extractSotCandidates', () => {
  it('should extract [SSoT] tagged lines', () => {
    const content = [
      '- `10:30:00` **[note]** 일반 메모',
      '- `10:31:00` **[SSoT]** 중요한 아키텍처 결정',
      '- `10:32:00` **[note]** 또 다른 메모',
    ].join('\n');

    const candidates = extractSotCandidates(content);

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toContain('중요한 아키텍처 결정');
  });

  it('should extract [DECISION] tagged lines', () => {
    const content = [
      '- `10:30:00` **[DECISION]** ESM 모듈 시스템 사용 결정',
      '- `10:31:00` **[note]** 일반 메모',
    ].join('\n');

    const candidates = extractSotCandidates(content);

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toContain('ESM 모듈 시스템 사용 결정');
  });

  it('should extract both SSoT and DECISION tags', () => {
    const content = [
      '- `10:30:00` **[SSoT]** 첫 번째 항목',
      '- `10:31:00` **[DECISION]** 두 번째 항목',
      '- `10:32:00` **[note]** 무시할 항목',
    ].join('\n');

    const candidates = extractSotCandidates(content);

    expect(candidates).toHaveLength(2);
  });

  it('should return empty array when no candidates', () => {
    const content = '- `10:30:00` **[note]** 일반 메모\n';

    const candidates = extractSotCandidates(content);

    expect(candidates).toHaveLength(0);
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
// SSoT promotion & spec sync
// ---------------------------------------------------------------------------

describe('ObsidianAdapter SSoT promotion', () => {
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

  it('promotes SSoT candidates from session log to CLAUDE.md', async () => {
    const logPath = await adapter.createSessionLog({
      role: 'worker',
      branch: 'feat/promote',
    });

    await adapter.appendSotCandidate(logPath, 'Always use strict mode');
    await adapter.appendDecision(logPath, 'Use vitest over jest');

    const entries = await adapter.promoteFromLog(logPath);

    expect(entries).toHaveLength(2);

    const claudeMd = await readFile(path.join(tmpDir, 'context', 'CLAUDE.md'), 'utf-8');
    expect(claudeMd).toContain('Always use strict mode');
    expect(claudeMd).toContain('Use vitest over jest');
  });

  it('returns empty array when no candidates', async () => {
    const logPath = await adapter.createSessionLog({
      role: 'worker',
      branch: 'feat/empty',
    });

    await adapter.appendToLog(logPath, 'Just a normal note');

    const entries = await adapter.promoteFromLog(logPath);
    expect(entries).toHaveLength(0);
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
