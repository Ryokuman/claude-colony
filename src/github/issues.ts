import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import type { ColonyConfig } from '../config.js';

const execFileAsync = promisify(execFile);

const IssueLabel = {
  Backlog: 'backlog',
  InProgress: 'in-progress',
  Blocked: 'blocked',
} as const;
type IssueLabel = (typeof IssueLabel)[keyof typeof IssueLabel];

export { IssueLabel };

export interface IssueInfo {
  number: number;
  title: string;
  state: 'open' | 'closed';
  labels: string[];
  url: string;
}

function assertGithubTaskManager(config: ColonyConfig): void {
  if (config.taskManager !== 'github') {
    throw new Error('Issues module requires taskManager to be "github"');
  }
}

async function gh(config: ColonyConfig, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('gh', args, {
    cwd: config.targetRepo,
    env: { ...process.env, GH_TOKEN: config.githubToken },
  });
  return stdout.trim();
}

export async function createIssue(
  config: ColonyConfig,
  options: {
    title: string;
    body: string;
    labels?: string[];
  },
): Promise<IssueInfo> {
  assertGithubTaskManager(config);

  const args = [
    'issue',
    'create',
    '--repo',
    config.github.repo,
    '--title',
    options.title,
    '--body',
    options.body,
  ];

  if (options.labels?.length) {
    args.push('--label', options.labels.join(','));
  }

  await gh(config, args);

  const listOutput = await gh(config, [
    'issue',
    'list',
    '--repo',
    config.github.repo,
    '--search',
    options.title,
    '--json',
    'number,title,state,labels,url',
    '--limit',
    '1',
  ]);

  const issues = JSON.parse(listOutput) as Array<{
    number: number;
    title: string;
    state: string;
    labels: Array<{ name: string }>;
    url: string;
  }>;

  const issue = issues[0];
  if (!issue) {
    throw new Error(`Failed to find created issue: ${options.title}`);
  }

  return {
    number: issue.number,
    title: issue.title,
    state: issue.state as IssueInfo['state'],
    labels: issue.labels.map((l) => l.name),
    url: issue.url,
  };
}

export async function updateLabel(
  config: ColonyConfig,
  issueNumber: number,
  label: IssueLabel,
): Promise<void> {
  assertGithubTaskManager(config);

  const labelsToRemove = Object.values(IssueLabel).filter((l) => l !== label);

  for (const removeLabel of labelsToRemove) {
    await gh(config, [
      'issue',
      'edit',
      String(issueNumber),
      '--repo',
      config.github.repo,
      '--remove-label',
      removeLabel,
    ]).catch(() => {});
  }

  await gh(config, [
    'issue',
    'edit',
    String(issueNumber),
    '--repo',
    config.github.repo,
    '--add-label',
    label,
  ]);
}

export async function closeIssue(config: ColonyConfig, issueNumber: number): Promise<void> {
  assertGithubTaskManager(config);

  await gh(config, [
    'issue',
    'close',
    String(issueNumber),
    '--repo',
    config.github.repo,
    '--reason',
    'completed',
  ]);
}
