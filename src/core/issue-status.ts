import type { IssueAdapter } from '../adapters/types.js';

export const IssueStatus = {
  Pending: 'pending',
  InProgress: 'in-progress',
  InReview: 'in-review',
  AwaitingMerge: 'awaiting-merge',
  Completed: 'completed',
} as const;
export type IssueStatus = (typeof IssueStatus)[keyof typeof IssueStatus];

const MANAGED_LABELS = [IssueStatus.InProgress, IssueStatus.InReview, IssueStatus.AwaitingMerge];

export interface IssueStatusInfo {
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

export async function setIssueStatus(
  adapter: IssueAdapter,
  issueNumber: number,
  status: IssueStatus,
): Promise<void> {
  if (status === IssueStatus.Pending || status === IssueStatus.Completed) {
    throw new Error(`Cannot set status to ${status} via labels`);
  }

  const labelsToRemove = MANAGED_LABELS.filter((l) => l !== status);
  for (const label of labelsToRemove) {
    await adapter.removeLabel(String(issueNumber), label).catch(() => {});
  }

  await adapter.addLabel(String(issueNumber), status);
}

export async function getIssueStatus(
  adapter: IssueAdapter,
  issueNumber: number,
): Promise<IssueStatusInfo> {
  const issue = await adapter.get(String(issueNumber));

  return {
    number: issue.number,
    title: issue.title,
    status: deriveStatus(issue.state, issue.labels),
    url: issue.url,
  };
}

export async function getAllIssueStatuses(adapter: IssueAdapter): Promise<IssueStatusInfo[]> {
  const issues = await adapter.list({ state: 'open', labels: MANAGED_LABELS });

  return issues.map((issue) => ({
    number: issue.number,
    title: issue.title,
    status: deriveStatus(issue.state, issue.labels),
    url: issue.url,
  }));
}
