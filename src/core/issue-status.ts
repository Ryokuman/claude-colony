import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { GithubError } from './errors.js';

const execFileAsync = promisify(execFile);

export const IssueStatus = {
  Pending: 'pending',
  InProgress: 'in-progress',
  InReview: 'in-review',
  AwaitingMerge: 'awaiting-merge',
  Completed: 'completed',
} as const;
export type IssueStatus = (typeof IssueStatus)[keyof typeof IssueStatus];

const MANAGED_LABELS = [IssueStatus.InProgress, IssueStatus.InReview, IssueStatus.AwaitingMerge];

async function gh(repo: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('gh', args, {
    env: { ...process.env },
  });
  return stdout.trim();
}

export async function setIssueStatus(
  repo: string,
  issueNumber: number,
  status: IssueStatus,
): Promise<void> {
  if (status === IssueStatus.Pending || status === IssueStatus.Completed) {
    throw new GithubError(`Cannot set status to ${status} via labels`);
  }

  const labelsToRemove = MANAGED_LABELS.filter((l) => l !== status);
  for (const label of labelsToRemove) {
    await gh(repo, ['issue', 'edit', String(issueNumber), '--repo', repo, '--remove-label', label]).catch(() => {});
  }

  await gh(repo, ['issue', 'edit', String(issueNumber), '--repo', repo, '--add-label', status]);
}

interface IssueStatusInfo {
  number: number;
  title: string;
  status: IssueStatus;
  url: string;
}

function deriveStatus(state: string, labels: string[]): IssueStatus {
  if (state === 'closed') return IssueStatus.Completed;
  if (labels.includes(IssueStatus.AwaitingMerge)) return IssueStatus.AwaitingMerge;
  if (labels.includes(IssueStatus.InReview)) return IssueStatus.InReview;
  if (labels.includes(IssueStatus.InProgress)) return IssueStatus.InProgress;
  return IssueStatus.Pending;
}

export async function getIssueStatus(repo: string, issueNumber: number): Promise<IssueStatusInfo> {
  const output = await gh(repo, [
    'issue', 'view', String(issueNumber), '--repo', repo,
    '--json', 'number,title,state,labels,url',
  ]);

  const data = JSON.parse(output) as {
    number: number;
    title: string;
    state: string;
    labels: Array<{ name: string }>;
    url: string;
  };

  return {
    number: data.number,
    title: data.title,
    status: deriveStatus(data.state, data.labels.map((l) => l.name)),
    url: data.url,
  };
}

export async function getAllIssueStatuses(repo: string): Promise<IssueStatusInfo[]> {
  const labels = MANAGED_LABELS.join(',');
  const output = await gh(repo, [
    'issue', 'list', '--repo', repo,
    '--label', labels,
    '--json', 'number,title,state,labels,url',
    '--limit', '100',
  ]);

  const issues = JSON.parse(output) as Array<{
    number: number;
    title: string;
    state: string;
    labels: Array<{ name: string }>;
    url: string;
  }>;

  return issues.map((issue) => ({
    number: issue.number,
    title: issue.title,
    status: deriveStatus(issue.state, issue.labels.map((l) => l.name)),
    url: issue.url,
  }));
}
