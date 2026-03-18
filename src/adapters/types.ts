import type { IssueStatus, IssueStatusInfo } from '../core/issue-status.js';

export interface Issue {
  id: string;
  number: number;
  title: string;
  body: string;
  state: 'open' | 'closed';
  labels: string[];
  url: string;
  platformStatus?: string;
}

export interface CreateIssueInput {
  title: string;
  body: string;
  labels?: string[];
  issueType?: 'story' | 'task';
  parentRef?: string;
}

export interface UpdateIssueInput {
  title?: string;
  body?: string;
  state?: 'open' | 'closed';
}

export interface ListIssuesOptions {
  state?: 'open' | 'closed' | 'all';
  labels?: string[];
  statuses?: string[];
  /** When true, return only issues that have at least one label. */
  hasLabel?: boolean;
  limit?: number;
}

export interface IssueAdapter {
  readonly type: string;

  // ── Issue CRUD ──
  list(options?: ListIssuesOptions): Promise<Issue[]>;
  get(issueRef: string): Promise<Issue>;
  create(input: CreateIssueInput): Promise<Issue>;
  update(issueRef: string, input: UpdateIssueInput): Promise<Issue>;
  addLabel(issueRef: string, label: string): Promise<void>;
  removeLabel(issueRef: string, label: string): Promise<void>;
  close(issueRef: string): Promise<void>;

  // ── Status semantics ──
  deriveStatus(issue: Issue): IssueStatus;
  setStatus(issueRef: string, status: IssueStatus): Promise<void>;
  listByStatus(statuses: IssueStatus[]): Promise<IssueStatusInfo[]>;
}

export const AdapterType = {
  GitHub: 'github',
  Jira: 'jira',
  Notion: 'notion',
  Obsidian: 'obsidian',
  Local: 'local',
} as const;
export type AdapterType = (typeof AdapterType)[keyof typeof AdapterType];

export interface GithubAdapterConfig {
  repo: string;
  baseBranch?: string;
}

export interface JiraAdapterConfig {
  host: string;
  projectKey: string;
  email: string;
}

export interface NotionAdapterConfig {
  databaseId: string;
  dataSourceId?: string;
  propertyNames?: {
    title?: string;
    body?: string;
    status?: string;
    labels?: string;
  };
}

export interface ObsidianAdapterConfig {
  vaultPath: string;
  issueFolder?: string;
}

export interface LocalAdapterConfig {
  filePath?: string;
}

/**
 * Maps the 3 transition status keys to platform-specific status names.
 * `todo` and `done` are excluded because they are derived from issue state,
 * not set via workflow transitions.
 */
export interface StatusMapping {
  'in-progress': string;
  reviewing: string;
  'waiting-merge': string;
}

export interface AdapterConfig {
  type: AdapterType;
  statusMapping?: Partial<StatusMapping>;
  github?: GithubAdapterConfig;
  jira?: JiraAdapterConfig;
  notion?: NotionAdapterConfig;
  obsidian?: ObsidianAdapterConfig;
  local?: LocalAdapterConfig;
}
