import { createAdapter } from '../adapters/adapter-factory.js';
import { loadConfig } from '../config.js';
import { GithubError } from '../core/errors.js';
import { TRANSITION_STATUSES } from '../core/issue-status.js';
import { logger } from '../core/logger.js';

const STATUS_ICONS: Record<string, string> = {
  todo: '○',
  'in-progress': '●',
  reviewing: '◎',
  'waiting-merge': '◉',
  done: '✓',
};

function formatStatus(status: string): string {
  return `${STATUS_ICONS[status] ?? '?'} ${status}`;
}

export async function runStatus(args: string[]): Promise<void> {
  const config = await loadConfig();
  const adapter = createAdapter(config.adapter, config.targetRepo);

  // Filter out 'status' command word
  const refs = args.filter((a) => a !== 'status' && !a.startsWith('--'));

  if (refs.length > 0) {
    await showSingleIssue(adapter, refs[0]);
  } else {
    await showAllIssues(adapter);
  }
}

async function showSingleIssue(
  adapter: import('../adapters/types.js').IssueAdapter,
  ref: string,
): Promise<void> {
  const issueNumber = ref.replace(/^#/, '');
  if (!/^\d+$/.test(issueNumber)) {
    throw new GithubError(`Invalid issue reference: ${ref}`);
  }

  const issue = await adapter.get(issueNumber);
  const status = adapter.deriveStatus(issue);
  logger.info(`#${issue.number} ${formatStatus(status)} ${issue.title}`);
  logger.info(`  ${issue.url}`);
}

async function showAllIssues(
  adapter: import('../adapters/types.js').IssueAdapter,
): Promise<void> {
  const issues = await adapter.listByStatus(TRANSITION_STATUSES);

  if (issues.length === 0) {
    logger.info('No tracked issues (in-progress, reviewing, or waiting-merge).');
    return;
  }

  logger.info('Tracked issues:');
  for (const issue of issues) {
    logger.info(`  #${issue.number} ${formatStatus(issue.status)} ${issue.title}`);
  }
}
