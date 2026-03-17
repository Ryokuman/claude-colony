import type { AdapterConfig, IssueAdapter, StatusMapping } from '../adapters/types.js';
import { DEFAULT_STATUS_MAPPINGS } from '../adapters/types.js';

export const IssueStatus = {
  Pending: 'todo',
  InProgress: 'in-progress',
  InReview: 'reviewing',
  AwaitingMerge: 'waiting-merge',
  Completed: 'done',
} as const;
export type IssueStatus = (typeof IssueStatus)[keyof typeof IssueStatus];

const TRANSITION_STATUSES: IssueStatus[] = [
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

/** Resolve the full StatusMapping from adapter config (user overrides + defaults). */
export function resolveStatusMapping(adapterConfig: AdapterConfig): StatusMapping {
  const defaults = DEFAULT_STATUS_MAPPINGS[adapterConfig.type] ?? DEFAULT_STATUS_MAPPINGS.local;
  return { ...defaults, ...adapterConfig.statusMapping };
}

/** Build a reverse map: platform status name → agent-hive internal key. */
function buildReverseMap(mapping: StatusMapping): Map<string, IssueStatus> {
  const reverse = new Map<string, IssueStatus>();
  for (const [key, value] of Object.entries(mapping)) {
    reverse.set(value.toLowerCase(), key as IssueStatus);
  }
  return reverse;
}

function deriveStatus(
  state: string,
  labels: string[],
  adapterType: string,
  mapping: StatusMapping,
): IssueStatus {
  if (state === 'closed') return IssueStatus.Completed;

  if (adapterType === 'github') {
    // GitHub: label-based status
    const reverseMap = buildReverseMap(mapping);
    for (const label of labels) {
      const status = reverseMap.get(label.toLowerCase());
      if (status && TRANSITION_STATUSES.includes(status)) return status;
    }
    return IssueStatus.Pending;
  }

  // Jira/Obsidian/Local: use the issue's labels or status field mapped back
  const reverseMap = buildReverseMap(mapping);
  for (const label of labels) {
    const status = reverseMap.get(label.toLowerCase());
    if (status) return status;
  }
  return IssueStatus.Pending;
}

export async function setIssueStatus(
  adapter: IssueAdapter,
  issueNumber: number,
  status: IssueStatus,
  adapterConfig: AdapterConfig,
): Promise<void> {
  if (status === IssueStatus.Pending || status === IssueStatus.Completed) {
    throw new Error(`Cannot set status to ${status} directly`);
  }

  const mapping = resolveStatusMapping(adapterConfig);
  const platformStatus = mapping[status];

  if (adapterConfig.type === 'github') {
    // GitHub: label-based — remove other managed labels, add target
    const managedLabels = TRANSITION_STATUSES.map((s) => mapping[s]);
    const labelsToRemove = managedLabels.filter((l) => l !== platformStatus);
    for (const label of labelsToRemove) {
      await adapter.removeLabel(String(issueNumber), label).catch(() => {});
    }
    await adapter.addLabel(String(issueNumber), platformStatus);
  } else if (adapterConfig.type === 'jira') {
    // Jira: native workflow transition
    if ('transitionTo' in adapter && typeof adapter.transitionTo === 'function') {
      await (adapter as IssueAdapter & { transitionTo(ref: string, name: string): Promise<void> })
        .transitionTo(String(issueNumber), platformStatus);
    }
  } else {
    // Obsidian/Local: label-based fallback
    const managedLabels = TRANSITION_STATUSES.map((s) => mapping[s]);
    const labelsToRemove = managedLabels.filter((l) => l !== platformStatus);
    for (const label of labelsToRemove) {
      await adapter.removeLabel(String(issueNumber), label).catch(() => {});
    }
    await adapter.addLabel(String(issueNumber), platformStatus);
  }
}

export async function getIssueStatus(
  adapter: IssueAdapter,
  issueNumber: number,
  adapterConfig: AdapterConfig,
): Promise<IssueStatusInfo> {
  const issue = await adapter.get(String(issueNumber));
  const mapping = resolveStatusMapping(adapterConfig);

  return {
    number: issue.number,
    title: issue.title,
    status: deriveStatus(issue.state, issue.labels, adapterConfig.type, mapping),
    url: issue.url,
  };
}

export async function getAllIssueStatuses(
  adapter: IssueAdapter,
  adapterConfig: AdapterConfig,
): Promise<IssueStatusInfo[]> {
  const mapping = resolveStatusMapping(adapterConfig);
  const managedLabels = TRANSITION_STATUSES.map((s) => mapping[s]);

  const issues = await adapter.list({ state: 'open', labels: managedLabels });

  return issues.map((issue) => ({
    number: issue.number,
    title: issue.title,
    status: deriveStatus(issue.state, issue.labels, adapterConfig.type, mapping),
    url: issue.url,
  }));
}
