import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { PermissionsConfig } from '../config.js';
import { DEFAULT_PERMISSIONS } from '../config.js';

export interface ClaudeSettings {
  permissions: {
    allow: string[];
  };
}

function buildSettings(permissions?: PermissionsConfig): ClaudeSettings {
  const allow = permissions?.allow ?? DEFAULT_PERMISSIONS.allow;
  return { permissions: { allow } };
}

/**
 * Write .claude/settings.json to the given worktree path.
 * Uses the allow list from config.permissions, falling back to sensible defaults.
 */
export async function writePermissionsFile(
  worktreePath: string,
  permissions?: PermissionsConfig,
): Promise<string> {
  const claudeDir = path.join(worktreePath, '.claude');
  await mkdir(claudeDir, { recursive: true });

  const settingsPath = path.join(claudeDir, 'settings.json');
  const settings = buildSettings(permissions);
  await writeFile(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf-8');

  return settingsPath;
}
