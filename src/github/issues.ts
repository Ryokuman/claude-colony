import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import type { HiveConfig } from '../config.js';
import { GithubError } from '../core/errors.js';

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
  body: string;
  state: 'open' | 'closed';
  labels: string[];
  url: string;
}

async function gh(config: HiveConfig, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('gh', args, {
    cwd: config.targetRepo,
    env: { ...process.env },
  });
  return stdout.trim();
}

export async function getIssue(config: HiveConfig, issueNumber: string): Promise<IssueInfo> {
  const output = await gh(config, [
    'issue',
    'view',
    issueNumber,
    '--repo',
    config.github.repo,
    '--json',
    'number,title,body,state,labels,url',
  ]);

  const data = JSON.parse(output) as {
    number: number;
    title: string;
    body: string;
    state: string;
    labels: Array<{ name: string }>;
    url: string;
  };

  return {
    number: data.number,
    title: data.title,
    body: data.body,
    state: data.state as IssueInfo['state'],
    labels: data.labels.map((l) => l.name),
    url: data.url,
  };
}

async function findCreatedIssue(config: HiveConfig, title: string): Promise<IssueInfo> {
  const listOutput = await gh(config, [
    'issue',
    'list',
    '--repo',
    config.github.repo,
    '--search',
    title,
    '--json',
    'number,title,body,state,labels,url',
    '--limit',
    '1',
  ]);

  const issues = JSON.parse(listOutput) as Array<{
    number: number;
    title: string;
    body: string;
    state: string;
    labels: Array<{ name: string }>;
    url: string;
  }>;

  const issue = issues[0];
  if (!issue) {
    throw new GithubError(`Failed to find created issue: ${title}`);
  }

  return {
    number: issue.number,
    title: issue.title,
    body: issue.body,
    state: issue.state as IssueInfo['state'],
    labels: issue.labels.map((l) => l.name),
    url: issue.url,
  };
}

export async function createIssue(
  config: HiveConfig,
  options: {
    title: string;
    body: string;
    labels?: string[];
  },
): Promise<IssueInfo> {
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

  return findCreatedIssue(config, options.title);
}

export async function updateLabel(
  config: HiveConfig,
  issueNumber: number,
  label: IssueLabel,
): Promise<void> {
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

export async function closeIssue(config: HiveConfig, issueNumber: number): Promise<void> {
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
