import { mkdir, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { writePermissionsFile } from './permissions.js';

describe('permissions', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = path.join(os.tmpdir(), `hive-test-permissions-${Date.now()}`);
    await mkdir(tmpDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('should write .claude/settings.json with default permissions', async () => {
    const settingsPath = await writePermissionsFile(tmpDir);

    expect(settingsPath).toBe(path.join(tmpDir, '.claude', 'settings.json'));

    const content = JSON.parse(await readFile(settingsPath, 'utf-8'));
    expect(content.permissions.allow).toEqual(['Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep']);
  });

  it('should write .claude/settings.json with custom permissions', async () => {
    const permissions = { allow: ['Bash(npm:*)', 'Read(*)', 'Write(*)'] };
    const settingsPath = await writePermissionsFile(tmpDir, permissions);

    const content = JSON.parse(await readFile(settingsPath, 'utf-8'));
    expect(content.permissions.allow).toEqual(['Bash(npm:*)', 'Read(*)', 'Write(*)']);
  });

  it('should create .claude directory if it does not exist', async () => {
    await writePermissionsFile(tmpDir);

    const content = await readFile(path.join(tmpDir, '.claude', 'settings.json'), 'utf-8');
    expect(content).toBeTruthy();
  });
});
