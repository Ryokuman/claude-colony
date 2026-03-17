import { execSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { AdapterType, StatusMapping } from '../adapters/types.js';
import { DEFAULT_STATUS_MAPPINGS } from '../adapters/types.js';
import { ObsidianAdapter } from '../adapters/obsidian-adapter.js';
import { ConfigError } from '../core/errors.js';
import { logger } from '../core/logger.js';

const DEFAULT_BASE_BRANCH = 'main';

interface InitOptions {
  repo: string;
  targetRepo: string;
  baseBranch: string;
  provider: string;
  language: string;
  obsidianVault: string;
  worktreeAutoClean: boolean;
  adapter: AdapterType;
  jiraHost: string;
  jiraProjectKey: string;
  jiraEmail: string;
}

function getArgValue(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return undefined;
  return args[idx + 1];
}

function parseInitArgs(args: string[]): InitOptions {
  const adapter = (getArgValue(args, '--adapter') ?? 'github') as AdapterType;
  const repo = getArgValue(args, '--repo');
  const targetRepo = getArgValue(args, '--target-repo');

  if (!targetRepo) throw new ConfigError('--target-repo is required (e.g., /path/to/repo)');

  // --repo is required for github adapter, optional for others
  if (adapter === 'github' && !repo) {
    throw new ConfigError('--repo is required for github adapter (e.g., owner/repo)');
  }

  return {
    repo: repo ?? '',
    targetRepo,
    baseBranch: getArgValue(args, '--base-branch') ?? DEFAULT_BASE_BRANCH,
    provider: getArgValue(args, '--provider') ?? 'claude',
    language: getArgValue(args, '--language') ?? 'en',
    obsidianVault: getArgValue(args, '--obsidian-vault') ?? '',
    worktreeAutoClean: args.includes('--worktree-auto-clean'),
    adapter,
    jiraHost: getArgValue(args, '--jira-host') ?? '',
    jiraProjectKey: getArgValue(args, '--jira-project-key') ?? '',
    jiraEmail: getArgValue(args, '--jira-email') ?? '',
  };
}

// ── Jira helpers ──

async function jiraRequest(
  host: string,
  auth: string,
  path: string,
  init?: RequestInit,
): Promise<unknown> {
  const res = await fetch(`${host}${path}`, {
    ...init,
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json', ...init?.headers },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Jira API ${path}: ${res.status} ${body}`);
  }
  return res.json();
}

/** Detect Jira project statuses and build statusMapping by pattern-matching. */
async function detectJiraStatusMapping(options: InitOptions): Promise<StatusMapping> {
  const defaults = DEFAULT_STATUS_MAPPINGS.jira;
  const token = process.env.JIRA_API_TOKEN;
  if (!token || !options.jiraHost || !options.jiraProjectKey || !options.jiraEmail) {
    return defaults;
  }

  const host = options.jiraHost.replace(/\/$/, '');
  const auth = Buffer.from(`${options.jiraEmail}:${token}`).toString('base64');

  try {
    const project = (await jiraRequest(host, auth, `/rest/api/3/project/${options.jiraProjectKey}`)) as {
      id: string;
      style?: string;
    };
    const searchParams = project.style === 'next-gen' ? `?projectId=${project.id}` : '';
    const statusData = (await jiraRequest(host, auth, `/rest/api/3/statuses/search${searchParams}`)) as {
      values: Array<{ name: string }>;
    };

    const names = statusData.values.map((s) => s.name);
    const mapping: Record<string, string> = {};

    const matchers: Array<{ key: keyof StatusMapping; patterns: string[] }> = [
      { key: 'todo', patterns: ['todo', 'to do', '해야 할 일', 'open', 'backlog'] },
      { key: 'in-progress', patterns: ['in progress', '진행 중', 'in development'] },
      { key: 'reviewing', patterns: ['reviewing', 'in review', 'review', '검토 중', '검토'] },
      { key: 'waiting-merge', patterns: ['waiting merge', 'awaiting merge', 'ready to merge', '병합 대기'] },
      { key: 'done', patterns: ['done', '완료', 'closed', 'resolved'] },
    ];

    for (const { key, patterns } of matchers) {
      const match = names.find((n) => patterns.includes(n.toLowerCase()));
      mapping[key] = match ?? defaults[key];
    }

    return mapping as unknown as StatusMapping;
  } catch {
    return defaults;
  }
}

// ── Config builder ──

function buildConfigJson(options: InitOptions, statusMapping: StatusMapping): string {
  const config: Record<string, unknown> = {
    targetRepo: options.targetRepo,
    provider: options.provider,
    language: options.language,
    github: {
      repo: options.repo,
      baseBranch: options.baseBranch,
    },
  };

  switch (options.adapter) {
    case 'jira':
      config.adapter = {
        type: 'jira',
        jira: {
          host: options.jiraHost,
          projectKey: options.jiraProjectKey,
          email: options.jiraEmail,
        },
        statusMapping,
      };
      break;
    case 'obsidian':
      config.adapter = {
        type: 'obsidian',
        obsidian: { vaultPath: options.obsidianVault },
        statusMapping,
      };
      break;
    case 'local':
      config.adapter = {
        type: 'local',
        statusMapping,
      };
      break;
    default:
      config.adapter = {
        type: 'github',
        github: { repo: options.repo },
        statusMapping,
      };
      break;
  }

  if (options.obsidianVault) {
    config.obsidian = { vaultPath: options.obsidianVault };
  }

  if (options.worktreeAutoClean) {
    config.worktree = { autoClean: true };
  }

  return JSON.stringify(config, null, 2);
}

// ── GitHub setup ──

async function setupGitHubLabels(repo: string, mapping: StatusMapping): Promise<void> {
  logger.info('Setting up GitHub labels...');

  // Create labels for the 3 transition statuses (todo/done are not labels)
  const labelsToCreate = [mapping['in-progress'], mapping.reviewing, mapping['waiting-merge']];

  for (const label of labelsToCreate) {
    try {
      execSync(`gh label create "${label}" --repo "${repo}" --force`, { stdio: 'pipe' });
      logger.info(`  ✓ Label created: ${label}`);
    } catch {
      logger.warn(`  Failed to create label "${label}" — it may already exist or gh CLI is not configured`);
    }
  }
}

// ── Main ──

export async function runInit(args: string[]): Promise<void> {
  const options = parseInitArgs(args);
  const outputDir = process.cwd();

  // Build statusMapping (Jira: auto-detect from project, others: defaults)
  let statusMapping: StatusMapping;
  if (options.adapter === 'jira') {
    statusMapping = await detectJiraStatusMapping(options);
  } else {
    statusMapping = DEFAULT_STATUS_MAPPINGS[options.adapter] ?? DEFAULT_STATUS_MAPPINGS.local;
  }

  logger.info('Status mapping:');
  for (const [key, value] of Object.entries(statusMapping)) {
    logger.info(`  ${key} → ${value}`);
  }

  const configContent = buildConfigJson(options, statusMapping);
  await writeFile(path.join(outputDir, 'ah.config.json'), configContent, 'utf-8');
  logger.info('Created ah.config.json');

  // Adapter-specific setup
  switch (options.adapter) {
    case 'github':
      if (options.repo) {
        await setupGitHubLabels(options.repo, statusMapping);
      }
      break;
    case 'jira':
      logger.info('Jira adapter configured. Status transitions use native Jira workflow.');
      logger.info('Ensure your project workflow has statuses matching the statusMapping above.');
      break;
  }

  if (options.obsidianVault) {
    const obsidian = new ObsidianAdapter({ vaultPath: options.obsidianVault });
    await obsidian.initVault();
    logger.info('Obsidian vault initialized', { path: options.obsidianVault });
  }

  logger.info('Initialization complete', {
    repo: options.repo,
    targetRepo: options.targetRepo,
    baseBranch: options.baseBranch,
    adapter: options.adapter,
    obsidian: options.obsidianVault || 'disabled',
  });
}
