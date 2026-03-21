import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { rm, readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

import { LocalAdapter } from '../../../src/adapters/local-adapter.js';
import { runAdapterContractTests } from './adapter-contract.js';

// ── Contract tests ──────────────────────────────────────────────────────

runAdapterContractTests('LocalAdapter', async () => {
  const tmpDir = path.join(os.tmpdir(), `agent-hive-local-contract-${Date.now()}`);
  const adapter = new LocalAdapter(undefined, tmpDir);
  return {
    adapter,
    teardown: async () => {
      await rm(tmpDir, { recursive: true, force: true });
    },
  };
});

// ── Local-specific tests ────────────────────────────────────────────────

describe('LocalAdapter — specific', () => {
  let tmpDir: string;
  let adapter: LocalAdapter;

  beforeEach(async () => {
    tmpDir = path.join(os.tmpdir(), `agent-hive-test-${Date.now()}`);
    adapter = new LocalAdapter(undefined, tmpDir);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
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
