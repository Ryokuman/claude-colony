import { loadConfig } from '../config.js';
import { ColonyError } from '../core/errors.js';
import { logger } from '../core/logger.js';
import { GithubAdapter } from '../adapters/github-adapter.js';

function getFlag(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return undefined;
  return args[idx + 1];
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

async function createGithubAdapter(): Promise<GithubAdapter> {
  const config = await loadConfig();
  return new GithubAdapter(
    { repo: config.github.repo, baseBranch: config.github.baseBranch },
    config.targetRepo,
  );
}

async function prCreate(args: string[]): Promise<void> {
  const title = getFlag(args, '--title');
  const body = getFlag(args, '--body');
  const head = getFlag(args, '--head');
  const base = getFlag(args, '--base');

  if (!title || !head) {
    throw new ColonyError(
      'Usage: agent-hive pr create --title "..." --body "..." --head <branch> [--base ...]',
      'CLI_ERROR',
    );
  }

  const adapter = await createGithubAdapter();
  const pr = await adapter.createPr({ title, body: body ?? '', head, base });

  logger.info(`Created PR #${pr.number}: ${pr.title}`);
  logger.info(`  URL: ${pr.url}`);
}

async function prStatus(args: string[]): Promise<void> {
  const ref = getPositionalAfterCommands(args, 2);
  if (!ref) {
    throw new ColonyError('Usage: agent-hive pr status <number> [--comments]', 'CLI_ERROR');
  }

  const prNumber = Number(ref.replace(/^#/, ''));
  if (Number.isNaN(prNumber)) {
    throw new ColonyError(`Invalid PR number: ${ref}`, 'CLI_ERROR');
  }

  const adapter = await createGithubAdapter();

  if (args.includes('--comments')) {
    const comments = await adapter.getPrComments(prNumber);
    if (comments.length === 0) {
      logger.info(`No comments on PR #${prNumber}`);
      return;
    }
    for (const c of comments) {
      logger.info(`[${c.createdAt}] @${c.author}:`);
      logger.info(`  ${c.body}`);
      logger.info('');
    }
    return;
  }

  const pr = await adapter.getPrStatus(prNumber);

  logger.info(`PR #${pr.number} [${pr.state}] ${pr.title}`);
  logger.info(`  Branch: ${pr.branch}`);
  logger.info(`  URL: ${pr.url}`);
}

async function prComment(args: string[]): Promise<void> {
  const ref = getPositionalAfterCommands(args, 2);
  const body = getFlag(args, '--body');

  if (!ref || !body) {
    throw new ColonyError('Usage: agent-hive pr comment <number> --body "..."', 'CLI_ERROR');
  }

  const prNumber = Number(ref.replace(/^#/, ''));
  if (Number.isNaN(prNumber)) {
    throw new ColonyError(`Invalid PR number: ${ref}`, 'CLI_ERROR');
  }

  const adapter = await createGithubAdapter();
  await adapter.addPrComment(prNumber, body);

  logger.info(`Added comment to PR #${prNumber}`);
}

export async function runPr(args: string[]): Promise<void> {
  const subArgs = args.filter((a) => a !== 'pr');
  const subcommand = subArgs.find((a) => !a.startsWith('--'));

  switch (subcommand) {
    case 'create':
      return prCreate(args);
    case 'status':
      return prStatus(args);
    case 'comment':
      return prComment(args);
    default:
      logger.error('Unknown pr subcommand. Use: create, status, comment');
      process.exit(1);
  }
}
