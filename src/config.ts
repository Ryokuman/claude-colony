import { readFile } from 'node:fs/promises';
import path from 'node:path';

import dotenv from 'dotenv';

import { ConfigError } from './core/errors.js';
import type { AdapterConfig } from './adapters/types.js';

export type { AdapterConfig } from './adapters/types.js';

export interface GithubConfig {
  repo: string;
  baseBranch: string;
}

export interface ObsidianConfig {
  vaultPath: string;
}

export interface WorktreeConfig {
  autoClean: boolean;
}

export interface ColonyConfig {
  targetRepo: string;
  provider: string;
  language: string;
  github: GithubConfig;
  obsidian?: ObsidianConfig;
  worktree: WorktreeConfig;
  adapter: AdapterConfig;
}

interface RawConfig {
  targetRepo?: string;
  provider?: string;
  language?: string;
  github?: Partial<GithubConfig>;
  obsidian?: { vaultPath?: string };
  worktree?: { autoClean?: boolean };
  adapter?: Partial<AdapterConfig>;
}

// Load .env so that user-defined env vars (e.g. GH_TOKEN) are available
// in process.env and passed through to spawned child processes (gh CLI, etc.).
function loadEnv(configDir: string): void {
  dotenv.config({ path: path.join(configDir, '.env') });
}

async function loadConfigFile(configDir: string): Promise<RawConfig> {
  const configPath = path.join(configDir, 'ah.config.json');
  try {
    const content = await readFile(configPath, 'utf-8');
    return JSON.parse(content) as RawConfig;
  } catch {
    return {};
  }
}

const VALID_PROVIDERS = ['claude', 'codex'];

function validateConfig(config: ColonyConfig): void {
  if (!config.targetRepo) {
    throw new ConfigError('targetRepo is required in ah.config.json');
  }

  if (!config.github.repo) {
    throw new ConfigError('github.repo is required in ah.config.json');
  }

  if (!VALID_PROVIDERS.includes(config.provider)) {
    throw new ConfigError(
      `Invalid provider: ${config.provider}. Must be one of: ${VALID_PROVIDERS.join(', ')}`,
    );
  }
}

export { ConfigError } from './core/errors.js';

export async function loadConfig(configDir?: string): Promise<ColonyConfig> {
  const dir = configDir ?? process.cwd();

  loadEnv(dir);
  const raw = await loadConfigFile(dir);

  if (!raw.adapter?.type) {
    throw new ConfigError('adapter.type is required in ah.config.json');
  }

  const adapter = raw.adapter as AdapterConfig;

  // adapter.type이 github이면 config.github 값을 강제 사용 (이중구조 방지)
  if (adapter.type === 'github') {
    adapter.github = {
      repo: raw.github?.repo ?? '',
      baseBranch: raw.github?.baseBranch ?? 'main',
    };
  }

  const config: ColonyConfig = {
    targetRepo: raw.targetRepo ?? '',
    provider: raw.provider ?? 'claude',
    language: raw.language ?? 'en',
    github: {
      repo: raw.github?.repo ?? '',
      baseBranch: raw.github?.baseBranch ?? 'main',
    },
    worktree: {
      autoClean: raw.worktree?.autoClean ?? false,
    },
    adapter,
  };

  if (raw.obsidian) {
    if (raw.obsidian.vaultPath) {
      config.obsidian = { vaultPath: raw.obsidian.vaultPath };
    } else {
      throw new ConfigError('obsidian.vaultPath is required when obsidian is configured');
    }
  }

  validateConfig(config);

  return config;
}
