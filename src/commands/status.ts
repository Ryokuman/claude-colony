import { loadConfig } from '../config.js';
import { GithubError } from '../core/errors.js';
import { getAllIssueStatuses, getIssueStatus } from '../core/issue-status.js';
import { logger } from '../core/logger.js';

const STATUS_ICONS: Record<string, string> = {
  pending: '○',
  'in-progress': '●',
  'in-review': '◎',
  'awaiting-merge': '◉',
  completed: '✓',
};

function formatStatus(status: string): string {
  return `${STATUS_ICONS[status] ?? '?'} ${status}`;
}

export async function runStatus(args: string[]): Promise<void> {
  const config = await loadConfig();

  // Filter out 'status' command word
  const refs = args.filter((a) => a !== 'status' && !a.startsWith('--'));

  if (refs.length > 0) {
    await showSingleIssue(config.github.repo, refs[0]);
  } else {
    await showAllIssues(config.github.repo);
  }
}

async function showSingleIssue(repo: string, ref: string): Promise<void> {
  const issueNumber = ref.replace(/^#/, '');
  if (!/^\d+$/.test(issueNumber)) {
    throw new GithubError(`Invalid issue reference: ${ref}`);
  }

  const info = await getIssueStatus(repo, Number(issueNumber));
  logger.info(`#${info.number} ${formatStatus(info.status)} ${info.title}`);
  logger.info(`  ${info.url}`);
}

async function showAllIssues(repo: string): Promise<void> {
  const issues = await getAllIssueStatuses(repo);

  if (issues.length === 0) {
    logger.info('No tracked issues (in-progress, in-review, or awaiting-merge).');
    return;
  }

  logger.info('Tracked issues:');
  for (const issue of issues) {
    logger.info(`  #${issue.number} ${formatStatus(issue.status)} ${issue.title}`);
  }
}
