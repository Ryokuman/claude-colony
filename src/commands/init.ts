import { writeFile } from 'node:fs/promises';
import path from 'node:path';

import { ConfigError } from '../core/errors.js';
import { logger } from '../core/logger.js';
import { initVault } from '../obsidian/vault-init.js';

const DEFAULT_BASE_BRANCH = 'main';

interface InitOptions {
  repo: string;
  targetRepo: string;
  baseBranch: string;
  provider: string;
  language: string;
  obsidianVault: string;
  worktreeAutoClean: boolean;
}

function getArgValue(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return undefined;
  return args[idx + 1];
}

function parseInitArgs(args: string[]): InitOptions {
  const repo = getArgValue(args, '--repo');
  const targetRepo = getArgValue(args, '--target-repo');

  if (!repo) throw new ConfigError('--repo is required (e.g., owner/repo)');
  if (!targetRepo) throw new ConfigError('--target-repo is required (e.g., /path/to/repo)');

  return {
    repo,
    targetRepo,
    baseBranch: getArgValue(args, '--base-branch') ?? DEFAULT_BASE_BRANCH,
    provider: getArgValue(args, '--provider') ?? 'claude',
    language: getArgValue(args, '--language') ?? 'en',
    obsidianVault: getArgValue(args, '--obsidian-vault') ?? '',
    worktreeAutoClean: args.includes('--worktree-auto-clean'),
  };
}

function buildConfigJson(options: InitOptions): string {
  const config: Record<string, unknown> = {
    targetRepo: options.targetRepo,
    provider: options.provider,
    language: options.language,
    github: {
      repo: options.repo,
      baseBranch: options.baseBranch,
    },
  };

  if (options.obsidianVault) {
    config.obsidian = {
      vaultPath: options.obsidianVault,
    };
  }

  if (options.worktreeAutoClean) {
    config.worktree = { autoClean: true };
  }

  return JSON.stringify(config, null, 2);
}

export async function runInit(args: string[]): Promise<void> {
  const options = parseInitArgs(args);
  const outputDir = process.cwd();

  const configContent = buildConfigJson(options);
  await writeFile(path.join(outputDir, 'colony.config.json'), configContent, 'utf-8');
  logger.info('Created colony.config.json');

  if (options.obsidianVault) {
    const tempConfig = {
      targetRepo: options.targetRepo,
      provider: options.provider,
      language: options.language,
      github: { repo: options.repo, baseBranch: options.baseBranch },
      worktree: { autoClean: options.worktreeAutoClean },
      obsidian: { vaultPath: options.obsidianVault },
    };
    await initVault(tempConfig);
    logger.info('Obsidian vault initialized', { path: options.obsidianVault });
  }

  logger.info('Initialization complete', {
    repo: options.repo,
    targetRepo: options.targetRepo,
    baseBranch: options.baseBranch,
    obsidian: options.obsidianVault || 'disabled',
  });
}
