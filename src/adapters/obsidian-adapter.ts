import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

import { AdapterError } from '../core/errors.js';
import type {
  CreateIssueInput,
  Issue,
  IssueAdapter,
  ListIssuesOptions,
  ObsidianAdapterConfig,
  UpdateIssueInput,
} from './types.js';

function parseFrontmatter(content: string): Record<string, string> {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};

  const result: Record<string, string> = {};
  for (const line of match[1].split('\n')) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    result[key] = value;
  }
  return result;
}

function extractBody(content: string): string {
  const match = content.match(/^---\n[\s\S]*?\n---\n([\s\S]*)$/);
  return match ? match[1].trim() : content.trim();
}

function parseIssueFile(filePath: string, content: string): Issue {
  const meta = parseFrontmatter(content);
  const basename = path.basename(filePath, '.md');
  const number = Number(meta.number) || Number(basename) || 0;

  return {
    id: basename,
    number,
    title: meta.title ?? basename,
    body: extractBody(content),
    state: meta.state === 'closed' ? 'closed' : 'open',
    labels: meta.labels ? meta.labels.split(',').map((l) => l.trim()) : [],
    url: '',
  };
}

function buildFrontmatter(issue: Issue): string {
  const lines = [
    '---',
    `title: ${issue.title}`,
    `number: ${issue.number}`,
    `state: ${issue.state}`,
  ];
  if (issue.labels.length > 0) {
    lines.push(`labels: ${issue.labels.join(', ')}`);
  }
  lines.push('---');
  return lines.join('\n');
}

function buildIssueMarkdown(issue: Issue): string {
  return `${buildFrontmatter(issue)}\n${issue.body}\n`;
}

async function readNextId(metaPath: string): Promise<number> {
  try {
    const content = await readFile(metaPath, 'utf-8');
    const meta = JSON.parse(content) as { nextId: number };
    return meta.nextId;
  } catch {
    return 1;
  }
}

async function writeNextId(metaPath: string, nextId: number): Promise<void> {
  await writeFile(metaPath, JSON.stringify({ nextId }, null, 2), 'utf-8');
}

export class ObsidianAdapter implements IssueAdapter {
  readonly type = 'obsidian';
  private readonly issueDir: string;
  private readonly metaPath: string;

  constructor(config: ObsidianAdapterConfig) {
    const folder = config.issueFolder ?? 'issues';
    this.issueDir = path.join(config.vaultPath, folder);
    this.metaPath = path.join(this.issueDir, '.meta.json');
  }

  async get(issueRef: string): Promise<Issue> {
    const filePath = path.join(this.issueDir, `${issueRef}.md`);
    try {
      const content = await readFile(filePath, 'utf-8');
      return parseIssueFile(filePath, content);
    } catch {
      throw new AdapterError(`Obsidian issue not found: ${issueRef}`);
    }
  }

  async list(options?: ListIssuesOptions): Promise<Issue[]> {
    try {
      const files = await readdir(this.issueDir);
      const mdFiles = files.filter((f) => f.endsWith('.md'));
      let issues: Issue[] = [];

      for (const file of mdFiles) {
        const filePath = path.join(this.issueDir, file);
        const content = await readFile(filePath, 'utf-8');
        issues.push(parseIssueFile(filePath, content));
      }

      if (options?.state && options.state !== 'all') {
        issues = issues.filter((i) => i.state === options.state);
      }
      if (options?.labels?.length) {
        issues = issues.filter((i) => options.labels!.some((l) => i.labels.includes(l)));
      }
      if (options?.limit) {
        issues = issues.slice(0, options.limit);
      }

      return issues;
    } catch {
      return [];
    }
  }

  async create(input: CreateIssueInput): Promise<Issue> {
    await mkdir(this.issueDir, { recursive: true });

    const nextId = await readNextId(this.metaPath);

    const issue: Issue = {
      id: String(nextId),
      number: nextId,
      title: input.title,
      body: input.body,
      state: 'open',
      labels: input.labels ?? [],
      url: '',
    };

    const filePath = path.join(this.issueDir, `${nextId}.md`);
    await writeFile(filePath, buildIssueMarkdown(issue), 'utf-8');
    await writeNextId(this.metaPath, nextId + 1);

    return issue;
  }

  async update(issueRef: string, input: UpdateIssueInput): Promise<Issue> {
    const issue = await this.get(issueRef);

    if (input.title !== undefined) issue.title = input.title;
    if (input.body !== undefined) issue.body = input.body;
    if (input.state !== undefined) issue.state = input.state;

    const filePath = path.join(this.issueDir, `${issueRef}.md`);
    await writeFile(filePath, buildIssueMarkdown(issue), 'utf-8');

    return issue;
  }

  async addLabel(issueRef: string, label: string): Promise<void> {
    const issue = await this.get(issueRef);
    if (!issue.labels.includes(label)) {
      issue.labels.push(label);
      const filePath = path.join(this.issueDir, `${issueRef}.md`);
      await writeFile(filePath, buildIssueMarkdown(issue), 'utf-8');
    }
  }

  async removeLabel(issueRef: string, label: string): Promise<void> {
    const issue = await this.get(issueRef);
    issue.labels = issue.labels.filter((l) => l !== label);
    const filePath = path.join(this.issueDir, `${issueRef}.md`);
    await writeFile(filePath, buildIssueMarkdown(issue), 'utf-8');
  }

  async close(issueRef: string): Promise<void> {
    await this.update(issueRef, { state: 'closed' });
  }
}
