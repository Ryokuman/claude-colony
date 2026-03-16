import type { ColonyConfig } from '../config.js';
import { ColonyError } from './errors.js';
import { getIssue, updateLabel, IssueLabel } from '../github/issues.js';

export interface IssueData {
  id: string;
  number: number;
  title: string;
  body: string;
  status: string;
  url: string;
}

export interface IssueSource {
  name: string;
  getIssue(ref: string): Promise<IssueData>;
  listIssues(filter?: Record<string, string>): Promise<IssueData[]>;
  setStatus(issueId: string, status: string): Promise<void>;
}

function createGitHubIssueSource(config: ColonyConfig): IssueSource {
  return {
    name: 'github',

    async getIssue(ref: string): Promise<IssueData> {
      const issue = await getIssue(config, ref);
      return {
        id: String(issue.number),
        number: issue.number,
        title: issue.title,
        body: issue.body,
        status: issue.state,
        url: issue.url,
      };
    },

    async listIssues(_filter?: Record<string, string>): Promise<IssueData[]> {
      // GitHub list is handled via issue-status.ts for now
      return [];
    },

    async setStatus(issueId: string, status: string): Promise<void> {
      const label = status as IssueLabel;
      await updateLabel(config, Number(issueId), label);
    },
  };
}

function createJiraIssueSource(_config: ColonyConfig): IssueSource {
  return {
    name: 'jira',

    async getIssue(_ref: string): Promise<IssueData> {
      throw new ColonyError(
        'Jira issue source not yet implemented. Contributions welcome!',
        'NOT_IMPLEMENTED',
      );
    },

    async listIssues(_filter?: Record<string, string>): Promise<IssueData[]> {
      throw new ColonyError(
        'Jira issue source not yet implemented. Contributions welcome!',
        'NOT_IMPLEMENTED',
      );
    },

    async setStatus(_issueId: string, _status: string): Promise<void> {
      throw new ColonyError(
        'Jira issue source not yet implemented. Contributions welcome!',
        'NOT_IMPLEMENTED',
      );
    },
  };
}

function createNotionIssueSource(_config: ColonyConfig): IssueSource {
  return {
    name: 'notion',

    async getIssue(_ref: string): Promise<IssueData> {
      throw new ColonyError(
        'Notion issue source not yet implemented. Contributions welcome!',
        'NOT_IMPLEMENTED',
      );
    },

    async listIssues(_filter?: Record<string, string>): Promise<IssueData[]> {
      throw new ColonyError(
        'Notion issue source not yet implemented. Contributions welcome!',
        'NOT_IMPLEMENTED',
      );
    },

    async setStatus(_issueId: string, _status: string): Promise<void> {
      throw new ColonyError(
        'Notion issue source not yet implemented. Contributions welcome!',
        'NOT_IMPLEMENTED',
      );
    },
  };
}

export function createIssueSource(config: ColonyConfig): IssueSource {
  const type = config.issueSource?.type ?? 'github';

  if (type === 'github') return createGitHubIssueSource(config);
  if (type === 'jira') return createJiraIssueSource(config);
  if (type === 'notion') return createNotionIssueSource(config);

  throw new ColonyError(`Unknown issue source type: ${type}`, 'CONFIG_ERROR');
}
