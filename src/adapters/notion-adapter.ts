import { AdapterError } from '../core/errors.js';
import type {
  CreateIssueInput,
  Issue,
  IssueAdapter,
  ListIssuesOptions,
  NotionAdapterConfig,
  UpdateIssueInput,
} from './types.js';

export class NotionAdapter implements IssueAdapter {
  readonly type = 'notion';
  private readonly databaseId: string;

  constructor(config: NotionAdapterConfig) {
    this.databaseId = config.databaseId;

    if (!process.env.NOTION_API_KEY) {
      throw new AdapterError('NOTION_API_KEY environment variable is required');
    }
  }

  async get(_issueRef: string): Promise<Issue> {
    throw new AdapterError('Notion adapter is not yet implemented');
  }

  async list(_options?: ListIssuesOptions): Promise<Issue[]> {
    throw new AdapterError('Notion adapter is not yet implemented');
  }

  async create(_input: CreateIssueInput): Promise<Issue> {
    throw new AdapterError('Notion adapter is not yet implemented');
  }

  async update(_issueRef: string, _input: UpdateIssueInput): Promise<Issue> {
    throw new AdapterError('Notion adapter is not yet implemented');
  }

  async addLabel(_issueRef: string, _label: string): Promise<void> {
    throw new AdapterError('Notion adapter is not yet implemented');
  }

  async removeLabel(_issueRef: string, _label: string): Promise<void> {
    throw new AdapterError('Notion adapter is not yet implemented');
  }

  async close(_issueRef: string): Promise<void> {
    throw new AdapterError('Notion adapter is not yet implemented');
  }
}
