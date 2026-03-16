import { readFile } from 'node:fs/promises';
import path from 'node:path';

import dotenv from 'dotenv';

import { ConfigError } from './core/errors.js';

const DEFAULT_DASHBOARD_PORT = 4000;
const DEFAULT_WEBHOOK_PORT = 4001;

export interface GithubConfig {
  repo: string;
}

export interface ObsidianConfig {
  vaultPath: string;
  enabled: boolean;
}

export interface PortsConfig {
  dashboard: number;
  webhook: number;
}

export interface SessionConfig {
  reviewerEnabled: boolean;
  autoSpawn: boolean;
}

export interface ColonyConfig {
  targetRepo: string;
  taskManager: 'github' | 'obsidian';
  github: GithubConfig;
  obsidian: ObsidianConfig;
  ports: PortsConfig;
  session: SessionConfig;
  githubToken: string;
  webhookSecret: string;
}

interface RawConfig {
  targetRepo?: string;
  taskManager?: string;
  github?: Partial<GithubConfig>;
  obsidian?: Partial<ObsidianConfig>;
  ports?: Partial<PortsConfig>;
  session?: Partial<SessionConfig>;
}

function loadEnv(configDir: string): void {
  dotenv.config({ path: path.join(configDir, '.env') });
}

async function loadConfigFile(configDir: string): Promise<RawConfig> {
  const configPath = path.join(configDir, 'colony.config.json');
  try {
    const content = await readFile(configPath, 'utf-8');
    return JSON.parse(content) as RawConfig;
  } catch {
    return {};
  }
}

function validateConfig(config: ColonyConfig): void {
  if (!config.targetRepo) {
    throw new ConfigError('targetRepo is required in colony.config.json');
  }

  if (config.taskManager !== 'github' && config.taskManager !== 'obsidian') {
    throw new ConfigError('taskManager must be "github" or "obsidian"');
  }

  if (config.taskManager === 'github' && !config.github.repo) {
    throw new ConfigError('github.repo is required when taskManager is "github"');
  }

  if (config.obsidian.enabled && !config.obsidian.vaultPath) {
    throw new ConfigError('obsidian.vaultPath is required when obsidian.enabled is true');
  }

  if (!config.githubToken) {
    throw new ConfigError('GITHUB_TOKEN is required in .env');
  }
}

export { ConfigError } from './core/errors.js';

export async function loadConfig(configDir?: string): Promise<ColonyConfig> {
  const dir = configDir ?? process.cwd();

  loadEnv(dir);
  const raw = await loadConfigFile(dir);

  const config: ColonyConfig = {
    targetRepo: raw.targetRepo ?? '',
    taskManager: (raw.taskManager as ColonyConfig['taskManager']) ?? 'github',
    github: {
      repo: raw.github?.repo ?? '',
    },
    obsidian: {
      vaultPath: raw.obsidian?.vaultPath ?? '',
      enabled: raw.obsidian?.enabled ?? false,
    },
    ports: {
      dashboard: raw.ports?.dashboard ?? DEFAULT_DASHBOARD_PORT,
      webhook: raw.ports?.webhook ?? DEFAULT_WEBHOOK_PORT,
    },
    session: {
      reviewerEnabled: raw.session?.reviewerEnabled ?? true,
      autoSpawn: raw.session?.autoSpawn ?? true,
    },
    githubToken: process.env.GITHUB_TOKEN ?? '',
    webhookSecret: process.env.WEBHOOK_SECRET ?? '',
  };

  validateConfig(config);

  return config;
}
