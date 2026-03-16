import { execFile } from 'node:child_process';
import { access } from 'node:fs/promises';
import { promisify } from 'node:util';
import path from 'node:path';

import { ColonyError } from './errors.js';
import { logger } from './logger.js';

const execFileAsync = promisify(execFile);

export interface WorktreeInfo {
  path: string;
  branch: string;
  head: string;
}

async function git(cwd: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', args, { cwd });
    return stdout.trim();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new ColonyError(`git ${args.join(' ')} failed: ${message}`, 'WORKTREE_ERROR');
  }
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function ensureBranchNotExists(targetRepo: string, branch: string): Promise<void> {
  try {
    await execFileAsync('git', ['rev-parse', '--verify', branch], { cwd: targetRepo });
    throw new ColonyError(`Branch '${branch}' already exists`, 'WORKTREE_ERROR');
  } catch (err) {
    if (err instanceof ColonyError) throw err;
    // Branch doesn't exist — good
  }
}

export async function createWorktree(
  targetRepo: string,
  branch: string,
  baseBranch: string,
): Promise<string> {
  const worktreePath = path.resolve(targetRepo, '..', `worktree-${branch}`);

  if (await pathExists(worktreePath)) {
    throw new ColonyError(`Worktree path already exists: ${worktreePath}`, 'WORKTREE_ERROR');
  }

  await ensureBranchNotExists(targetRepo, branch);
  await git(targetRepo, ['fetch', 'origin', baseBranch]);
  await git(targetRepo, ['worktree', 'add', '-b', branch, worktreePath, `origin/${baseBranch}`]);

  logger.info(`Created worktree at ${worktreePath} on branch ${branch}`);
  return worktreePath;
}

export async function listWorktrees(targetRepo: string): Promise<WorktreeInfo[]> {
  const output = await git(targetRepo, ['worktree', 'list', '--porcelain']);
  const entries: WorktreeInfo[] = [];
  let current: Partial<WorktreeInfo> = {};

  for (const line of output.split('\n')) {
    if (line.startsWith('worktree ')) {
      current.path = line.slice('worktree '.length);
    } else if (line.startsWith('HEAD ')) {
      current.head = line.slice('HEAD '.length);
    } else if (line.startsWith('branch ')) {
      current.branch = line.slice('branch refs/heads/'.length);
    } else if (line === '') {
      if (current.path && current.branch) {
        entries.push(current as WorktreeInfo);
      }
      current = {};
    }
  }

  if (current.path && current.branch) {
    entries.push(current as WorktreeInfo);
  }

  // Filter out main worktree (first entry is always the main one)
  return entries.slice(1);
}

export async function removeWorktree(targetRepo: string, worktreePath: string): Promise<void> {
  await git(targetRepo, ['worktree', 'remove', worktreePath, '--force']);
  logger.info(`Removed worktree at ${worktreePath}`);
}

export async function cleanWorktrees(
  targetRepo: string,
  completedBranches: string[],
): Promise<string[]> {
  const worktrees = await listWorktrees(targetRepo);
  const removed: string[] = [];

  for (const wt of worktrees) {
    if (completedBranches.includes(wt.branch)) {
      await removeWorktree(targetRepo, wt.path);
      removed.push(wt.path);
    }
  }

  return removed;
}
