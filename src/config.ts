import { readFile } from 'node:fs/promises';
import path from 'node:path';

import dotenv from 'dotenv';

import { ConfigError } from './core/errors.js';

export interface GithubConfig {
  repo: string;
  baseBranch: string;
}

export interface ObsidianConfig {
  vaultPath: string;
}

export interface PermissionsConfig {
  allow: string[];
}

export interface HiveConfig {
  targetRepo: string;
  provider: string;
  github: GithubConfig;
  obsidian?: ObsidianConfig;
  permissions?: PermissionsConfig;
}

interface RawConfig {
  targetRepo?: string;
  provider?: string;
  github?: Partial<GithubConfig>;
  obsidian?: { vaultPath?: string };
  permissions?: { allow?: string[] };
}

// Load .env so that user-defined env vars (e.g. GH_TOKEN) are available
// in process.env and passed through to spawned child processes (gh CLI, etc.).
function loadEnv(configDir: string): void {
  dotenv.config({ path: path.join(configDir, '.env') });
}

async function loadConfigFile(configDir: string): Promise<RawConfig> {
  const configPath = path.join(configDir, 'hive.config.json');
  try {
    const content = await readFile(configPath, 'utf-8');
    return JSON.parse(content) as RawConfig;
  } catch {
    return {};
  }
}

const VALID_PROVIDERS = ['claude', 'codex'];

function validateConfig(config: HiveConfig): void {
  if (!config.targetRepo) {
    throw new ConfigError('targetRepo is required in hive.config.json');
  }

  if (!config.github.repo) {
    throw new ConfigError('github.repo is required in hive.config.json');
  }

  if (!VALID_PROVIDERS.includes(config.provider)) {
    throw new ConfigError(
      `Invalid provider: ${config.provider}. Must be one of: ${VALID_PROVIDERS.join(', ')}`,
    );
  }
}

export { ConfigError } from './core/errors.js';

export const DEFAULT_PERMISSIONS: PermissionsConfig = {
  allow: [
    'Bash(npm:*)',
    'Bash(npx:*)',
    'Bash(git:*)',
    'Bash(tsc:*)',
    'Bash(node:*)',
    'Read',
    'Glob',
    'Grep',
    'Write',
    'Edit',
  ],
};

export async function loadConfig(configDir?: string): Promise<HiveConfig> {
  const dir = configDir ?? process.cwd();

  loadEnv(dir);
  const raw = await loadConfigFile(dir);

  const config: HiveConfig = {
    targetRepo: raw.targetRepo ?? '',
    provider: raw.provider ?? 'claude',
    github: {
      repo: raw.github?.repo ?? '',
      baseBranch: raw.github?.baseBranch ?? 'main',
    },
  };

  if (raw.obsidian?.vaultPath) {
    config.obsidian = {
      vaultPath: raw.obsidian.vaultPath,
    };
  }

  if (raw.permissions?.allow) {
    config.permissions = { allow: raw.permissions.allow };
  }

  validateConfig(config);

  return config;
}
