import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import type { ColonyConfig } from '../config.js';
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
  state: 'open' | 'closed';
  labels: string[];
  url: string;
}

async function gh(config: ColonyConfig, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('gh', args, {
    cwd: config.targetRepo,
    env: { ...process.env },
  });
  return stdout.trim();
}

export async function getIssue(
  config: ColonyConfig,
  issueRef: string,
): Promise<IssueInfo & { body: string }> {
  const output = await gh(config, [
    'issue', 'view', issueRef, '--repo', config.github.repo,
    '--json', 'number,title,state,labels,url,body',
  ]);

  const data = JSON.parse(output) as {
    number: number;
    title: string;
    state: string;
    labels: Array<{ name: string }>;
    url: string;
    body: string;
  };

  return {
    number: data.number,
    title: data.title,
    state: data.state as IssueInfo['state'],
    labels: data.labels.map((l) => l.name),
    url: data.url,
    body: data.body,
  };
}

export async function createIssue(
  config: ColonyConfig,
  options: { title: string; body: string; labels?: string[] },
): Promise<IssueInfo> {
  const args = [
    'issue', 'create', '--repo', config.github.repo,
    '--title', options.title, '--body', options.body,
  ];

  if (options.labels?.length) {
    args.push('--label', options.labels.join(','));
  }

  await gh(config, args);

  // Find the created issue by title
  const listOutput = await gh(config, [
    'issue', 'list', '--repo', config.github.repo,
    '--search', options.title, '--json', 'number,title,state,labels,url', '--limit', '1',
  ]);

  const issues = JSON.parse(listOutput) as Array<{
    number: number; title: string; state: string; labels: Array<{ name: string }>; url: string;
  }>;

  const issue = issues[0];
  if (!issue) throw new GithubError(`Failed to find created issue: ${options.title}`);

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
  const labelsToRemove = Object.values(IssueLabel).filter((l) => l !== label);

  for (const removeLabel of labelsToRemove) {
    await gh(config, [
      'issue', 'edit', String(issueNumber), '--repo', config.github.repo, '--remove-label', removeLabel,
    ]).catch(() => {});
  }

  await gh(config, [
    'issue', 'edit', String(issueNumber), '--repo', config.github.repo, '--add-label', label,
  ]);
}

export async function closeIssue(config: ColonyConfig, issueNumber: number): Promise<void> {
  await gh(config, [
    'issue', 'close', String(issueNumber), '--repo', config.github.repo, '--reason', 'completed',
  ]);
}
