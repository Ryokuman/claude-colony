import { createAdapter } from '../adapters/adapter-factory.js';
import { loadConfig } from '../config.js';
import { ColonyError } from '../core/errors.js';
import { logger } from '../core/logger.js';

function getFlag(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return undefined;
  return args[idx + 1];
}

function getFlagValues(args: string[], flag: string): string[] {
  const values: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === flag && i + 1 < args.length) {
      values.push(args[i + 1]);
      i++;
    }
  }
  return values;
}

function hasFlag(args: string[], flag: string): boolean {
  return args.includes(flag);
}

function getPositionalAfterCommands(args: string[], commandCount: number): string | undefined {
  let count = 0;
  for (const a of args) {
    if (a.startsWith('--')) break;
    count++;
    if (count > commandCount) return a;
  }
  return undefined;
}

async function createIssueAdapter() {
  const config = await loadConfig();
  return createAdapter(config.adapter, config.targetRepo);
}

async function issueGet(args: string[]): Promise<void> {
  const ref = getPositionalAfterCommands(args, 2);
  if (!ref) {
    throw new ColonyError('Usage: agent-hive issue get <ref>', 'CLI_ERROR');
  }

  const adapter = await createIssueAdapter();
  const issue = await adapter.get(ref.replace(/^#/, ''));

  logger.info(`#${issue.number} [${issue.state}] ${issue.title}`);
  logger.info(`  Labels: ${issue.labels.length > 0 ? issue.labels.join(', ') : '(none)'}`);
  logger.info(`  URL: ${issue.url}`);
  if (issue.body) {
    logger.info(`  Body:\n${issue.body}`);
  }
}

async function issueList(args: string[]): Promise<void> {
  const state = getFlag(args, '--state') as 'open' | 'closed' | 'all' | undefined;
  const labels = getFlagValues(args, '--label');

  const adapter = await createIssueAdapter();
  const issues = await adapter.list({ state, labels: labels.length > 0 ? labels : undefined });

  if (issues.length === 0) {
    logger.info('No issues found.');
    return;
  }

  for (const issue of issues) {
    const labelStr = issue.labels.length > 0 ? ` [${issue.labels.join(', ')}]` : '';
    logger.info(`#${issue.number} [${issue.state}] ${issue.title}${labelStr}`);
  }
}

async function issueCreate(args: string[]): Promise<void> {
  const title = getFlag(args, '--title');
  const body = getFlag(args, '--body');
  const labels = getFlagValues(args, '--label');

  if (!title) {
    throw new ColonyError('Usage: agent-hive issue create --title "..." --body "..."', 'CLI_ERROR');
  }

  const adapter = await createIssueAdapter();
  const issue = await adapter.create({
    title,
    body: body ?? '',
    labels: labels.length > 0 ? labels : undefined,
  });

  logger.info(`Created issue #${issue.number}: ${issue.title}`);
  logger.info(`  URL: ${issue.url}`);
}

async function issueUpdate(args: string[]): Promise<void> {
  const ref = getPositionalAfterCommands(args, 2);
  if (!ref) {
    throw new ColonyError(
      'Usage: agent-hive issue update <ref> [--title ...] [--body ...] [--state ...]',
      'CLI_ERROR',
    );
  }

  const title = getFlag(args, '--title');
  const body = getFlag(args, '--body');
  const state = getFlag(args, '--state') as 'open' | 'closed' | undefined;

  if (!title && !body && !state) {
    throw new ColonyError('At least one of --title, --body, --state is required', 'CLI_ERROR');
  }

  const adapter = await createIssueAdapter();
  const issue = await adapter.update(ref.replace(/^#/, ''), { title, body, state });

  logger.info(`Updated issue #${issue.number}: ${issue.title}`);
}

async function issueLabel(args: string[]): Promise<void> {
  const ref = getPositionalAfterCommands(args, 2);
  if (!ref) {
    throw new ColonyError(
      'Usage: agent-hive issue label <ref> --add/--remove <label>',
      'CLI_ERROR',
    );
  }

  const addLabels = getFlagValues(args, '--add');
  const removeLabels = getFlagValues(args, '--remove');

  if (addLabels.length === 0 && removeLabels.length === 0) {
    throw new ColonyError('At least one of --add or --remove is required', 'CLI_ERROR');
  }

  const adapter = await createIssueAdapter();
  const issueRef = ref.replace(/^#/, '');

  for (const label of addLabels) {
    await adapter.addLabel(issueRef, label);
    logger.info(`Added label "${label}" to #${issueRef}`);
  }

  for (const label of removeLabels) {
    await adapter.removeLabel(issueRef, label);
    logger.info(`Removed label "${label}" from #${issueRef}`);
  }
}

async function issueClose(args: string[]): Promise<void> {
  const ref = getPositionalAfterCommands(args, 2);
  if (!ref) {
    throw new ColonyError('Usage: agent-hive issue close <ref>', 'CLI_ERROR');
  }

  const adapter = await createIssueAdapter();
  await adapter.close(ref.replace(/^#/, ''));
  logger.info(`Closed issue #${ref.replace(/^#/, '')}`);
}

export async function runIssue(args: string[]): Promise<void> {
  const subArgs = args.filter((a) => a !== 'issue');
  const subcommand = subArgs.find((a) => !a.startsWith('--'));

  switch (subcommand) {
    case 'get':
      return issueGet(args);
    case 'list':
      return issueList(args);
    case 'create':
      return issueCreate(args);
    case 'update':
      return issueUpdate(args);
    case 'label':
      return issueLabel(args);
    case 'close':
      return issueClose(args);
    default:
      logger.error('Unknown issue subcommand. Use: get, list, create, update, label, close');
      process.exit(1);
  }
}
