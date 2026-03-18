import type { AdapterConfig, IssueAdapter, StatusMapping } from '../adapters/types.js';

import { ConfigError } from './errors.js';

export const IssueStatus = {
  Pending: 'todo',
  InProgress: 'in-progress',
  InReview: 'reviewing',
  AwaitingMerge: 'waiting-merge',
  Completed: 'done',
} as const;
export type IssueStatus = (typeof IssueStatus)[keyof typeof IssueStatus];

export const TRANSITION_STATUSES: IssueStatus[] = [
  IssueStatus.InProgress,
  IssueStatus.InReview,
  IssueStatus.AwaitingMerge,
];

export interface IssueStatusInfo {
  number: number;
  title: string;
  status: IssueStatus;
  url: string;
}

/** Default transition status mappings per adapter type. */
export const DEFAULT_STATUS_MAPPINGS: Record<string, StatusMapping> = {
  github: {
    'in-progress': 'in-progress',
    reviewing: 'in-review',
    'waiting-merge': 'awaiting-merge',
  },
  jira: {
    'in-progress': 'In Progress',
    reviewing: 'REVIEWING',
    'waiting-merge': 'WAITING MERGE',
  },
  obsidian: {
    'in-progress': 'in-progress',
    reviewing: 'reviewing',
    'waiting-merge': 'waiting-merge',
  },
  local: {
    'in-progress': 'in-progress',
    reviewing: 'reviewing',
    'waiting-merge': 'waiting-merge',
  },
};

/** Resolve the full StatusMapping from adapter config (user overrides + defaults). */
export function resolveStatusMapping(adapterConfig: AdapterConfig): StatusMapping {
  const defaults = DEFAULT_STATUS_MAPPINGS[adapterConfig.type] ?? DEFAULT_STATUS_MAPPINGS.local;
  const mapping = { ...defaults, ...adapterConfig.statusMapping };

  // Validate no duplicate platform status values
  const seen = new Map<string, string>();
  for (const [key, value] of Object.entries(mapping)) {
    const lower = value.toLowerCase();
    if (seen.has(lower)) {
      throw new ConfigError(
        `Duplicate statusMapping: "${value}" is mapped to both "${seen.get(lower)}" and "${key}". Each platform status name must be unique.`,
      );
    }
    seen.set(lower, key);
  }

  return mapping;
}

/** Find the internal status key matching a platform status value (case-insensitive). */
export function findStatusKey(
  mapping: StatusMapping,
  platformValue: string,
): IssueStatus | undefined {
  return Object.keys(mapping).find(
    (k) => mapping[k as keyof StatusMapping].toLowerCase() === platformValue.toLowerCase(),
  ) as IssueStatus | undefined;
}

// ---------------------------------------------------------------------------
// Thin delegation wrappers (kept for backward compatibility during migration)
// ---------------------------------------------------------------------------

export async function setIssueStatus(
  adapter: IssueAdapter,
  issueNumber: number,
  status: IssueStatus,
): Promise<void> {
  await adapter.setStatus(String(issueNumber), status);
}

export async function getIssueStatus(
  adapter: IssueAdapter,
  issueNumber: number,
): Promise<IssueStatusInfo> {
  const issue = await adapter.get(String(issueNumber));
  return {
    number: issue.number,
    title: issue.title,
    status: adapter.deriveStatus(issue),
    url: issue.url,
  };
}

export async function getAllIssueStatuses(adapter: IssueAdapter): Promise<IssueStatusInfo[]> {
  return adapter.listByStatus(TRANSITION_STATUSES);
}
