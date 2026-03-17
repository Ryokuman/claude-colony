import { randomUUID } from 'node:crypto';
import { access, appendFile, readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
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

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SessionLogOptions {
  role: 'worker' | 'reviewer';
  branch: string;
  issueNumber?: number;
  prNumber?: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VAULT_DIRS = ['spec', 'context', 'sessions'] as const;

const DEFAULT_CLAUDE_MD = `# 프로젝트 컨벤션 및 패턴

> 이 문서는 SSoT (Single Source of Truth)입니다.
> 세션이 발견한 중요 결정사항이 여기에 승격됩니다.

---

## 코드 컨벤션

(프로젝트 초기화 후 자동으로 채워집니다)

## 아키텍처 결정사항

(세션 작업 중 중요 결정사항이 승격되면 여기에 추가됩니다)

## 반복 패턴

(세션이 발견한 반복 패턴이 여기에 기록됩니다)
`;

// ---------------------------------------------------------------------------
// Pure helpers (issue markdown)
// ---------------------------------------------------------------------------

function parseFrontmatter(content: string): Record<string, string> {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};

  const result: Record<string, string> = {};
  for (const line of match[1].split('\n')) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const rawValue = line.slice(idx + 1).trim();
    const value =
      rawValue.startsWith('"') && rawValue.endsWith('"')
        ? rawValue.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\')
        : rawValue;
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
    labels: meta.labels ? meta.labels.split(',').map((l) => l.trim()).filter(Boolean) : [],
    url: '',
  };
}

function yamlEscape(value: string): string {
  if (/[:#\[\]{}|>&*!?,'"@`]/.test(value) || value.startsWith(' ') || value.endsWith(' ')) {
    return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  }
  return value;
}

function buildFrontmatter(issue: Issue): string {
  const lines = [
    '---',
    `title: ${yamlEscape(issue.title)}`,
    `number: ${issue.number}`,
    `state: ${issue.state}`,
  ];
  if (issue.labels.length > 0) {
    lines.push(`labels: ${issue.labels.map(yamlEscape).join(', ')}`);
  }
  lines.push('---');
  return lines.join('\n');
}

function buildIssueMarkdown(issue: Issue): string {
  return `${buildFrontmatter(issue)}\n${issue.body}\n`;
}

// ---------------------------------------------------------------------------
// Pure helpers (session logging / SSoT)
// ---------------------------------------------------------------------------

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function formatTimestamp(date: Date): string {
  return date.toISOString().slice(11, 19);
}

// ---------------------------------------------------------------------------
// Helpers (meta id persistence)
// ---------------------------------------------------------------------------

async function readNextId(metaPath: string): Promise<number> {
  try {
    const content = await readFile(metaPath, 'utf-8');
    const meta = JSON.parse(content) as { nextId: number };
    return Number(meta.nextId) || 1;
  } catch {
    return 1;
  }
}

async function writeNextId(metaPath: string, nextId: number): Promise<void> {
  await writeFile(metaPath, JSON.stringify({ nextId }, null, 2), 'utf-8');
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// ObsidianAdapter
// ---------------------------------------------------------------------------

export class ObsidianAdapter implements IssueAdapter {
  readonly type = 'obsidian';
  private readonly vaultPath: string;
  private readonly issueDir: string;
  private readonly metaPath: string;

  constructor(config: ObsidianAdapterConfig) {
    this.vaultPath = config.vaultPath;
    const folder = config.issueFolder ?? 'issues';
    this.issueDir = path.join(config.vaultPath, folder);
    this.metaPath = path.join(this.issueDir, '.meta.json');
  }

  // -----------------------------------------------------------------------
  // Issue CRUD (existing)
  // -----------------------------------------------------------------------

  private normalizeRef(issueRef: string): string {
    return issueRef.replace(/^#/, '');
  }

  async get(issueRef: string): Promise<Issue> {
    const ref = this.normalizeRef(issueRef);
    const filePath = path.join(this.issueDir, `${ref}.md`);
    try {
      const content = await readFile(filePath, 'utf-8');
      return parseIssueFile(filePath, content);
    } catch {
      throw new AdapterError(`Obsidian issue not found: ${ref}`);
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
    const ref = this.normalizeRef(issueRef);
    const issue = await this.get(ref);

    if (input.title !== undefined) issue.title = input.title;
    if (input.body !== undefined) issue.body = input.body;
    if (input.state !== undefined) issue.state = input.state;

    const filePath = path.join(this.issueDir, `${ref}.md`);
    await writeFile(filePath, buildIssueMarkdown(issue), 'utf-8');

    return issue;
  }

  async addLabel(issueRef: string, label: string): Promise<void> {
    const ref = this.normalizeRef(issueRef);
    const issue = await this.get(ref);
    if (!issue.labels.includes(label)) {
      issue.labels.push(label);
      const filePath = path.join(this.issueDir, `${ref}.md`);
      await writeFile(filePath, buildIssueMarkdown(issue), 'utf-8');
    }
  }

  async removeLabel(issueRef: string, label: string): Promise<void> {
    const ref = this.normalizeRef(issueRef);
    const issue = await this.get(ref);
    if (!issue.labels.includes(label)) return;
    issue.labels = issue.labels.filter((l) => l !== label);
    const filePath = path.join(this.issueDir, `${ref}.md`);
    await writeFile(filePath, buildIssueMarkdown(issue), 'utf-8');
  }

  async close(issueRef: string): Promise<void> {
    const ref = this.normalizeRef(issueRef);
    await this.update(ref, { state: 'closed' });
  }

  // -----------------------------------------------------------------------
  // Vault initialisation
  // -----------------------------------------------------------------------

  async initVault(): Promise<void> {
    for (const dir of VAULT_DIRS) {
      await mkdir(path.join(this.vaultPath, dir), { recursive: true });
    }

    const claudeMdPath = path.join(this.vaultPath, 'context', 'CLAUDE.md');
    if (!(await fileExists(claudeMdPath))) {
      await writeFile(claudeMdPath, DEFAULT_CLAUDE_MD, 'utf-8');
    }
  }

  // -----------------------------------------------------------------------
  // Session logging
  // -----------------------------------------------------------------------

  async createSessionLog(options: SessionLogOptions): Promise<string> {
    const now = new Date();
    const logPath = this.buildLogPath(options, now);
    const sessionsDir = path.dirname(logPath);

    await mkdir(sessionsDir, { recursive: true });

    const lines = [
      `# ${options.role} 세션 기록서`,
      '',
      `- **브랜치**: ${options.branch}`,
      `- **시작 시각**: ${now.toISOString()}`,
    ];

    if (options.issueNumber) {
      lines.push(`- **관련 Issue**: #${options.issueNumber}`);
    }
    if (options.prNumber) {
      lines.push(`- **관련 PR**: #${options.prNumber}`);
    }

    lines.push('', '---', '');

    await writeFile(logPath, lines.join('\n'), 'utf-8');
    return logPath;
  }

  async appendToLog(logPath: string, content: string): Promise<void> {
    const timestamp = formatTimestamp(new Date());
    const line = `- \`${timestamp}\` ${content}\n`;
    await appendFile(logPath, line, 'utf-8');
  }

  async appendDecision(logPath: string, decision: string): Promise<void> {
    await this.appendToLog(logPath, `**[DECISION]** ${decision}`);
  }

  async appendSotCandidate(logPath: string, content: string): Promise<void> {
    await this.appendToLog(logPath, `**[SSoT]** ${content}`);
  }

  async appendBlocker(logPath: string, reason: string, issueNumber: number): Promise<void> {
    await this.appendToLog(logPath, `**[BLOCKER]** ${reason} (Issue #${issueNumber})`);
  }

  async closeSessionLog(logPath: string, summary: string): Promise<void> {
    const closing = [
      '',
      '---',
      '',
      '## 세션 종료 요약',
      '',
      summary,
      '',
      `> 종료 시각: ${new Date().toISOString()}`,
      '',
    ].join('\n');

    await appendFile(logPath, closing, 'utf-8');
  }

  async syncToSpec(topic: string, content: string): Promise<void> {
    const specDir = path.join(this.vaultPath, 'spec');
    await mkdir(specDir, { recursive: true });

    const sanitizedTopic = topic.replace(/[^a-zA-Z0-9가-힣\-_]/g, '-').toLowerCase();
    const specPath = path.join(specDir, `${sanitizedTopic}.md`);

    const existing = await readFile(specPath, 'utf-8').catch(() => null);

    if (existing !== null) {
      const update = [
        '',
        `---`,
        '',
        `## 업데이트 (${formatDate(new Date())})`,
        '',
        content,
        '',
      ].join('\n');
      await appendFile(specPath, update, 'utf-8');
    } else {
      const newDoc = [`# ${topic}`, '', content, ''].join('\n');
      await writeFile(specPath, newDoc, 'utf-8');
    }
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  private buildLogPath(options: SessionLogOptions, date: Date): string {
    const sanitizedBranch = options.branch.replace(/\//g, '-');
    const uid = randomUUID().slice(0, 8);
    return path.join(
      this.vaultPath,
      'sessions',
      `${options.role}-${sanitizedBranch}-${formatDate(date)}-${uid}.md`,
    );
  }

}
