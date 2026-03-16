export interface Issue {
  id: string;
  number: number;
  title: string;
  body: string;
  state: 'open' | 'closed';
  labels: string[];
  url: string;
}

export interface CreateIssueInput {
  title: string;
  body: string;
  labels?: string[];
}

export interface UpdateIssueInput {
  title?: string;
  body?: string;
  state?: 'open' | 'closed';
}

export interface ListIssuesOptions {
  state?: 'open' | 'closed' | 'all';
  labels?: string[];
  limit?: number;
}

export interface IssueAdapter {
  readonly type: string;
  list(options?: ListIssuesOptions): Promise<Issue[]>;
  get(issueRef: string): Promise<Issue>;
  create(input: CreateIssueInput): Promise<Issue>;
  update(issueRef: string, input: UpdateIssueInput): Promise<Issue>;
  addLabel(issueRef: string, label: string): Promise<void>;
  removeLabel(issueRef: string, label: string): Promise<void>;
  close(issueRef: string): Promise<void>;
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
  project: string;
  email: string;
}

export interface NotionAdapterConfig {
  databaseId: string;
}

export interface ObsidianAdapterConfig {
  vaultPath: string;
  issueFolder?: string;
}

export interface LocalAdapterConfig {
  filePath?: string;
}

export interface AdapterConfig {
  type: AdapterType;
  github?: GithubAdapterConfig;
  jira?: JiraAdapterConfig;
  notion?: NotionAdapterConfig;
  obsidian?: ObsidianAdapterConfig;
  local?: LocalAdapterConfig;
}
