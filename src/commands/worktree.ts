import { loadConfig } from '../config.js';
import { ConfigError, GithubError } from '../core/errors.js';
import { createIssueSource } from '../core/issue-source.js';
import { IssueStatus, setIssueStatus } from '../core/issue-status.js';
import { logger } from '../core/logger.js';
import { spawnLeadSession } from '../core/session-spawner.js';
import { createWorktree, listWorktrees, removeWorktree } from '../core/worktree.js';
import { initVault } from '../obsidian/vault-init.js';

function getArgValue(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return undefined;
  return args[idx + 1];
}

function parseIssueRef(input: string): string {
  const urlMatch = input.match(/github\.com\/[\w.-]+\/[\w.-]+\/issues\/(\d+)/);
  if (urlMatch) return urlMatch[1];

  const shortMatch = input.match(/^[\w.-]+\/[\w.-]+#(\d+)$/);
  if (shortMatch) return shortMatch[1];

  if (/^\d+$/.test(input)) return input;
  if (/^#\d+$/.test(input)) return input.slice(1);

  throw new GithubError(`Invalid issue reference: ${input}`);
}

function extractIssueRefs(args: string[]): string[] {
  const flagsWithValues = new Set(['--provider', '--branch']);
  const refs: string[] = [];

  for (let i = 0; i < args.length; i++) {
    if (flagsWithValues.has(args[i])) {
      i++;
      continue;
    }
    if (args[i].startsWith('--')) continue;
    if (args[i] === 'worktree' || args[i] === 'create' || args[i] === 'clean' || args[i] === 'list') continue;
    refs.push(args[i]);
  }

  return refs;
}

export async function runWorktreeCreate(args: string[]): Promise<void> {
  const branch = getArgValue(args, '--branch');
  if (!branch) {
    throw new ConfigError('--branch is required (e.g., --branch feat/my-feature)');
  }

  const providerArg = getArgValue(args, '--provider');
  const issueRefs = extractIssueRefs(args);

  if (issueRefs.length === 0) {
    throw new GithubError('At least one issue reference is required');
  }

  const config = await loadConfig();

  if (providerArg) {
    if (!['claude', 'codex'].includes(providerArg)) {
      throw new ConfigError(`Invalid provider: ${providerArg}. Must be claude or codex.`);
    }
    config.provider = providerArg;
  }

  if (config.obsidian) {
    await initVault(config);
  }

  const worktreePath = await createWorktree(config.targetRepo, branch, config.github.baseBranch);
  const issueSource = createIssueSource(config);

  // Process issues sequentially in the same worktree
  for (const ref of issueRefs) {
    const issueNumber = parseIssueRef(ref);
    const issue = await issueSource.getIssue(issueNumber);

    logger.info(`[Issue #${issue.number}] ${issue.title}`);
    await setIssueStatus(config.github.repo, issue.number, IssueStatus.InProgress);

    await spawnLeadSession({
      config: { ...config, targetRepo: worktreePath },
      issueNumber: issue.number,
      issueTitle: issue.title,
      issueBody: issue.body,
    });
  }
}

export async function runWorktreeList(): Promise<void> {
  const config = await loadConfig();
  const worktrees = await listWorktrees(config.targetRepo);

  if (worktrees.length === 0) {
    logger.info('No active worktrees.');
    return;
  }

  logger.info('Active worktrees:');
  for (const wt of worktrees) {
    logger.info(`  ${wt.branch} → ${wt.path}`);
  }
}

export async function runWorktreeClean(): Promise<void> {
  const config = await loadConfig();
  const worktrees = await listWorktrees(config.targetRepo);

  if (worktrees.length === 0) {
    logger.info('No worktrees to clean.');
    return;
  }

  let removed = 0;
  for (const wt of worktrees) {
    try {
      await removeWorktree(config.targetRepo, wt.path);
      removed++;
    } catch {
      logger.warn(`Could not remove worktree at ${wt.path} (may have uncommitted changes)`);
    }
  }

  logger.info(`Cleaned ${removed} worktree(s).`);
}
