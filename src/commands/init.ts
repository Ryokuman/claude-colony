import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { ConfigError } from '../core/errors.js';
import { logger } from '../core/logger.js';

const DEFAULT_BASE_BRANCH = 'main';
const DEFAULT_WEBHOOK_PORT = 4001;
const DEFAULT_DASHBOARD_PORT = 4000;

interface InitOptions {
  repo: string;
  targetRepo: string;
  token: string;
  webhookSecret: string;
  baseBranch: string;
  obsidianVault: string;
  webhookPort: number;
  dashboardPort: number;
}

function getArgValue(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return undefined;
  return args[idx + 1];
}

function parseInitArgs(args: string[]): InitOptions {
  const repo = getArgValue(args, '--repo');
  const targetRepo = getArgValue(args, '--target-repo');
  const token = getArgValue(args, '--token');

  if (!repo) throw new ConfigError('--repo is required (e.g., owner/repo)');
  if (!targetRepo) throw new ConfigError('--target-repo is required (e.g., /path/to/repo)');
  if (!token) throw new ConfigError('--token is required (GitHub PAT)');

  const webhookPortStr = getArgValue(args, '--webhook-port');
  const dashboardPortStr = getArgValue(args, '--dashboard-port');

  return {
    repo,
    targetRepo,
    token,
    webhookSecret: getArgValue(args, '--webhook-secret') ?? '',
    baseBranch: getArgValue(args, '--base-branch') ?? DEFAULT_BASE_BRANCH,
    obsidianVault: getArgValue(args, '--obsidian-vault') ?? '',
    webhookPort: webhookPortStr ? Number(webhookPortStr) : DEFAULT_WEBHOOK_PORT,
    dashboardPort: dashboardPortStr ? Number(dashboardPortStr) : DEFAULT_DASHBOARD_PORT,
  };
}

function buildConfigJson(options: InitOptions): string {
  const config = {
    targetRepo: options.targetRepo,
    taskManager: options.obsidianVault ? 'obsidian' : 'github',
    github: {
      repo: options.repo,
      baseBranch: options.baseBranch,
    },
    obsidian: {
      vaultPath: options.obsidianVault,
      enabled: Boolean(options.obsidianVault),
    },
    ports: {
      dashboard: options.dashboardPort,
      webhook: options.webhookPort,
    },
    session: {
      reviewerEnabled: true,
      autoSpawn: true,
    },
  };

  return JSON.stringify(config, null, 2);
}

function buildEnvContent(options: InitOptions): string {
  const lines = [`GITHUB_TOKEN=${options.token}`];
  if (options.webhookSecret) {
    lines.push(`WEBHOOK_SECRET=${options.webhookSecret}`);
  }
  return lines.join('\n') + '\n';
}

async function setBranchProtection(options: InitOptions): Promise<void> {
  const url = `https://api.github.com/repos/${options.repo}/branches/${options.baseBranch}/protection`;
  const body = {
    required_pull_request_reviews: {
      required_approving_review_count: 1,
    },
    enforce_admins: true,
    required_status_checks: null,
    restrictions: null,
  };

  const response = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${options.token}`,
      Accept: 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    logger.warn('Failed to set branch protection (may require admin access)', {
      status: response.status,
      response: text,
    });
    return;
  }

  logger.info(`Branch protection set on ${options.baseBranch}`);
}

async function initObsidianVault(vaultPath: string): Promise<void> {
  const dirs = ['tasks', 'tasks/todo', 'tasks/in-progress', 'tasks/done', 'sessions', 'logs'];

  for (const dir of dirs) {
    await mkdir(path.join(vaultPath, dir), { recursive: true });
  }

  logger.info('Obsidian vault structure initialized', { path: vaultPath });
}

export async function runInit(args: string[]): Promise<void> {
  const options = parseInitArgs(args);
  const outputDir = process.cwd();

  const configContent = buildConfigJson(options);
  await writeFile(path.join(outputDir, 'colony.config.json'), configContent, 'utf-8');
  logger.info('Created colony.config.json');

  const envContent = buildEnvContent(options);
  await writeFile(path.join(outputDir, '.env'), envContent, 'utf-8');
  logger.info('Created .env');

  await setBranchProtection(options);

  if (options.obsidianVault) {
    await initObsidianVault(options.obsidianVault);
  }

  logger.info('Initialization complete', {
    repo: options.repo,
    targetRepo: options.targetRepo,
    baseBranch: options.baseBranch,
    dashboardPort: options.dashboardPort,
    webhookPort: options.webhookPort,
    obsidianVault: options.obsidianVault || 'disabled',
  });
}
