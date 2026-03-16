import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

import { ObsidianAdapter } from './obsidian-adapter.js';

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
