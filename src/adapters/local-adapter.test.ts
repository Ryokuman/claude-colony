import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { rm, readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

import { LocalAdapter } from './local-adapter.js';

describe('LocalAdapter', () => {
  let tmpDir: string;
  let adapter: LocalAdapter;

  beforeEach(async () => {
    tmpDir = path.join(os.tmpdir(), `agent-hive-test-${Date.now()}`);
    adapter = new LocalAdapter(undefined, tmpDir);
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
  });

  it('lists issues', async () => {
    await adapter.create({ title: 'First', body: '' });
    await adapter.create({ title: 'Second', body: '' });

    const all = await adapter.list();
    expect(all).toHaveLength(2);
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
    await expect(adapter.get('999')).rejects.toThrow('Issue #999 not found');
  });

  it('persists to JSON file', async () => {
    await adapter.create({ title: 'Persisted', body: '' });

    const filePath = path.join(tmpDir, '.colony', 'issues.json');
    const content = await readFile(filePath, 'utf-8');
    const store = JSON.parse(content);

    expect(store.nextId).toBe(2);
    expect(store.issues).toHaveLength(1);
  });

  it('auto-increments issue numbers', async () => {
    const first = await adapter.create({ title: 'First', body: '' });
    const second = await adapter.create({ title: 'Second', body: '' });

    expect(first.number).toBe(1);
    expect(second.number).toBe(2);
  });
});
