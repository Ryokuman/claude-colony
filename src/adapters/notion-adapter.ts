import { Client } from '@notionhq/client';

import { AdapterError } from '../core/errors.js';
import { logger } from '../core/logger.js';
import {
  type IssueStatus,
  type IssueStatusInfo,
  IssueStatus as Status,
  TRANSITION_STATUSES,
  findStatusKey,
  DEFAULT_STATUS_MAPPINGS,
} from '../core/issue-status.js';
import type {
  CreateIssueInput,
  Issue,
  IssueAdapter,
  ListIssuesOptions,
  NotionAdapterConfig,
  StatusMapping,
  UpdateIssueInput,
} from './types.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface NotionPropertyNames {
  title: string;
  body: string;
  status: string;
  labels: string;
}

type NotionPage = Awaited<ReturnType<Client['pages']['retrieve']>>;
type RichTextItem = { plain_text: string };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractPlainText(richText: RichTextItem[]): string {
  return richText.map((t) => t.plain_text).join('');
}

function getProperty(page: Record<string, unknown>, key: string): unknown {
  const props = page.properties as Record<string, Record<string, unknown>> | undefined;
  return props?.[key];
}

function extractTitle(page: Record<string, unknown>, propName: string): string {
  const prop = getProperty(page, propName) as { title?: RichTextItem[] } | undefined;
  return prop?.title ? extractPlainText(prop.title) : '';
}

function extractRichText(page: Record<string, unknown>, propName: string): string {
  const prop = getProperty(page, propName) as { rich_text?: RichTextItem[] } | undefined;
  return prop?.rich_text ? extractPlainText(prop.rich_text) : '';
}

function extractStatus(page: Record<string, unknown>, propName: string): string | undefined {
  const prop = getProperty(page, propName) as { status?: { name: string } } | undefined;
  return prop?.status?.name;
}

function extractMultiSelect(page: Record<string, unknown>, propName: string): string[] {
  const prop = getProperty(page, propName) as {
    multi_select?: Array<{ name: string }>;
  } | undefined;
  return prop?.multi_select?.map((s) => s.name) ?? [];
}

function extractUrl(page: Record<string, unknown>): string {
  return (page as Record<string, unknown>).url as string ?? '';
}

function extractPageNumber(page: Record<string, unknown>): number {
  // Try unique_id property first (Notion's auto-incrementing ID)
  const props = (page as Record<string, unknown>).properties as
    | Record<string, Record<string, unknown>>
    | undefined;
  if (props) {
    for (const value of Object.values(props)) {
      if (value && typeof value === 'object' && 'unique_id' in value) {
        const uid = value.unique_id as { number?: number } | undefined;
        if (uid?.number !== undefined) return uid.number;
      }
    }
  }

  // Fallback: use a hash of the page ID
  const id = (page as Record<string, unknown>).id as string;
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

// ---------------------------------------------------------------------------
// NotionAdapter
// ---------------------------------------------------------------------------

export class NotionAdapter implements IssueAdapter {
  readonly type = 'notion';
  private readonly client: Client;
  private readonly databaseId: string;
  private dataSourceId: string | undefined;
  private readonly props: NotionPropertyNames;
  private readonly mapping: StatusMapping;

  constructor(
    config: NotionAdapterConfig,
    statusMapping?: Partial<StatusMapping>,
    client?: Client,
  ) {
    this.databaseId = config.databaseId;
    this.dataSourceId = config.dataSourceId;
    this.props = {
      title: config.propertyNames?.title ?? 'Name',
      body: config.propertyNames?.body ?? 'Description',
      status: config.propertyNames?.status ?? 'Status',
      labels: config.propertyNames?.labels ?? 'Tags',
    };
    this.mapping = {
      ...DEFAULT_STATUS_MAPPINGS.notion,
      ...statusMapping,
    };

    this.client = client ?? new Client({ auth: process.env.NOTION_API_KEY });
  }

  // -----------------------------------------------------------------------
  // Data source resolution
  // -----------------------------------------------------------------------

  private async resolveDataSourceId(): Promise<string> {
    if (this.dataSourceId) return this.dataSourceId;

    const db = await this.client.databases.retrieve({ database_id: this.databaseId });
    const dataSources = (db as Record<string, unknown>).data_sources as
      | Array<{ id: string }>
      | undefined;

    if (dataSources?.length) {
      this.dataSourceId = dataSources[0].id;
      return this.dataSourceId;
    }

    // Fallback: use database_id as data_source_id (older API versions)
    this.dataSourceId = this.databaseId;
    return this.dataSourceId;
  }

  // -----------------------------------------------------------------------
  // Page → Issue mapping
  // -----------------------------------------------------------------------

  private pageToIssue(page: NotionPage): Issue {
    const p = page as unknown as Record<string, unknown>;
    const isArchived = p.archived === true || p.in_trash === true;
    const statusName = extractStatus(p, this.props.status);

    return {
      id: (p.id as string) ?? '',
      number: extractPageNumber(p),
      title: extractTitle(p, this.props.title),
      body: extractRichText(p, this.props.body),
      state: isArchived ? 'closed' : 'open',
      labels: extractMultiSelect(p, this.props.labels),
      url: extractUrl(p),
      platformStatus: statusName,
    };
  }

  // -----------------------------------------------------------------------
  // Issue CRUD
  // -----------------------------------------------------------------------

  async get(issueRef: string): Promise<Issue> {
    try {
      const page = await this.client.pages.retrieve({ page_id: issueRef });
      return this.pageToIssue(page);
    } catch {
      throw new AdapterError(`Notion page not found: ${issueRef}`);
    }
  }

  async list(options?: ListIssuesOptions): Promise<Issue[]> {
    const dsId = await this.resolveDataSourceId();
    const filterConditions: unknown[] = [];

    // Note: archived/trashed pages are not returned by dataSources.query,
    // so state='closed' will return empty unless pages have a status property
    // indicating completion. state='open' is the default behavior (non-archived).
    if (options?.labels?.length) {
      for (const label of options.labels) {
        filterConditions.push({
          property: this.props.labels,
          multi_select: { contains: label },
        });
      }
    }

    if (options?.statuses?.length) {
      // OR filter for multiple status values
      const statusOr = options.statuses.map((s) => ({
        property: this.props.status,
        status: { equals: s },
      }));
      if (statusOr.length === 1) {
        filterConditions.push(statusOr[0]);
      } else {
        filterConditions.push({ or: statusOr });
      }
    }

    const filter =
      filterConditions.length === 0
        ? undefined
        : filterConditions.length === 1
          ? (filterConditions[0] as Record<string, unknown>)
          : { and: filterConditions };

    const allIssues: Issue[] = [];
    let startCursor: string | undefined;
    const limit = options?.limit ?? 1000;

    while (allIssues.length < limit) {
      const response = (await (this.client as unknown as Record<string, Record<string, (...args: unknown[]) => Promise<unknown>>>)
        .dataSources.query({
          data_source_id: dsId,
          filter,
          page_size: Math.min(100, limit - allIssues.length),
          start_cursor: startCursor,
        })) as {
        results: NotionPage[];
        has_more: boolean;
        next_cursor: string | null;
      };

      allIssues.push(...response.results.map((p) => this.pageToIssue(p)));

      if (!response.has_more || !response.next_cursor) break;
      startCursor = response.next_cursor;
    }

    return allIssues;
  }

  async create(input: CreateIssueInput): Promise<Issue> {
    const properties: Record<string, unknown> = {
      [this.props.title]: {
        title: [{ text: { content: input.title } }],
      },
    };

    // Only set body property if the property name is configured and body is non-empty
    if (input.body) {
      properties[this.props.body] = {
        rich_text: [{ text: { content: input.body } }],
      };
    }

    if (input.labels?.length) {
      properties[this.props.labels] = {
        multi_select: input.labels.map((name) => ({ name })),
      };
    }

    const page = await this.client.pages.create({
      parent: { database_id: this.databaseId } as unknown as Parameters<Client['pages']['create']>[0]['parent'],
      properties: properties as Parameters<Client['pages']['create']>[0]['properties'],
    });

    return this.pageToIssue(page);
  }

  async update(issueRef: string, input: UpdateIssueInput): Promise<Issue> {
    const properties: Record<string, unknown> = {};

    if (input.title !== undefined) {
      properties[this.props.title] = {
        title: [{ text: { content: input.title } }],
      };
    }
    if (input.body !== undefined) {
      properties[this.props.body] = {
        rich_text: [{ text: { content: input.body } }],
      };
    }

    // state='closed' is handled by close() via archiving, not here
    const updateArgs: Record<string, unknown> = { page_id: issueRef };
    if (Object.keys(properties).length > 0) {
      updateArgs.properties = properties;
    }
    if (input.state === 'closed') {
      updateArgs.archived = true;
    }

    if (Object.keys(updateArgs).length > 1) {
      await this.client.pages.update(
        updateArgs as Parameters<Client['pages']['update']>[0],
      );
    }

    return this.get(issueRef);
  }

  async addLabel(issueRef: string, label: string): Promise<void> {
    const issue = await this.get(issueRef);
    if (issue.labels.includes(label)) return;

    const newLabels = [...issue.labels, label];
    await this.client.pages.update({
      page_id: issueRef,
      properties: {
        [this.props.labels]: {
          multi_select: newLabels.map((name) => ({ name })),
        },
      } as Parameters<Client['pages']['update']>[0]['properties'],
    });
  }

  async removeLabel(issueRef: string, label: string): Promise<void> {
    const issue = await this.get(issueRef);
    if (!issue.labels.includes(label)) return;

    const newLabels = issue.labels.filter((l) => l !== label);
    await this.client.pages.update({
      page_id: issueRef,
      properties: {
        [this.props.labels]: {
          multi_select: newLabels.map((name) => ({ name })),
        },
      } as Parameters<Client['pages']['update']>[0]['properties'],
    });
  }

  async close(issueRef: string): Promise<void> {
    // In Notion API 2025-09-03, closing = archiving the page
    await this.client.pages.update({
      page_id: issueRef,
      archived: true,
    } as Parameters<Client['pages']['update']>[0]);
  }

  // -----------------------------------------------------------------------
  // Setup — ensure required DB properties exist
  // -----------------------------------------------------------------------

  async setup(): Promise<void> {
    await this.ensureProperties();
  }

  private async ensureProperties(): Promise<void> {
    const dsId = await this.resolveDataSourceId();

    const dsClient = (
      this.client as unknown as Record<
        string,
        Record<string, (...args: unknown[]) => Promise<unknown>>
      >
    ).dataSources;

    let existing: Record<string, { type: string }>;
    try {
      const dsInfo = (await dsClient.retrieve({
        data_source_id: dsId,
      })) as { properties: Record<string, { type: string }> };
      existing = dsInfo.properties ?? {};
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(`Failed to retrieve data source properties: ${msg}`);
      return;
    }

    const required: Array<{ name: string; schema: Record<string, unknown> }> = [];

    if (!existing[this.props.body]) {
      required.push({ name: this.props.body, schema: { rich_text: {} } });
    }
    if (!existing[this.props.status]) {
      required.push({ name: this.props.status, schema: { status: {} } });
    }
    if (!existing[this.props.labels]) {
      required.push({ name: this.props.labels, schema: { multi_select: {} } });
    }

    if (required.length === 0) {
      logger.info('All required Notion DB properties already exist.');
      return;
    }

    const propertiesToAdd: Record<string, unknown> = {};
    for (const { name, schema } of required) {
      propertiesToAdd[name] = schema;
    }

    try {
      await dsClient.update({
        data_source_id: dsId,
        properties: propertiesToAdd,
      });
      for (const { name } of required) {
        logger.info(`  Added Notion property: ${name}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(`Failed to create Notion DB properties: ${msg}`);
    }
  }

  // -----------------------------------------------------------------------
  // Status semantics
  // -----------------------------------------------------------------------

  deriveStatus(issue: Issue): IssueStatus {
    if (issue.state === 'closed') return Status.Completed;

    if (issue.platformStatus) {
      const status = findStatusKey(this.mapping, issue.platformStatus);
      if (status) return status;
    }
    return Status.Pending;
  }

  async setStatus(issueRef: string, status: IssueStatus): Promise<void> {
    if (status === Status.Pending || status === Status.Completed) {
      throw new Error(`Cannot set status to ${status} directly`);
    }

    const platformStatus = this.mapping[status as keyof StatusMapping];
    await this.client.pages.update({
      page_id: issueRef,
      properties: {
        [this.props.status]: {
          status: { name: platformStatus },
        },
      } as Parameters<Client['pages']['update']>[0]['properties'],
    });
  }

  async listByStatus(statuses: IssueStatus[]): Promise<IssueStatusInfo[]> {
    const managedStatuses = statuses
      .filter((s): s is keyof StatusMapping => s in this.mapping)
      .map((s) => this.mapping[s]);
    const issues = await this.list({ state: 'open', statuses: managedStatuses });

    return issues.map((issue) => ({
      number: issue.number,
      title: issue.title,
      status: this.deriveStatus(issue),
      url: issue.url,
    }));
  }
}
