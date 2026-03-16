import { mkdir, appendFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { ColonyConfig } from '../config.js';

const SessionRole = {
  Worker: 'worker',
  Reviewer: 'reviewer',
} as const;
type SessionRole = (typeof SessionRole)[keyof typeof SessionRole];

export { SessionRole };

export interface SessionLogEntry {
  timestamp: string;
  type: 'decision' | 'issue' | 'blocker' | 'note' | 'sot-candidate';
  content: string;
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function formatTimestamp(date: Date): string {
  return date.toISOString().slice(11, 19);
}

function buildLogPath(config: ColonyConfig, role: SessionRole, branch: string, date: Date): string {
  const sanitizedBranch = branch.replace(/\//g, '-');
  return path.join(
    config.obsidian!.vaultPath,
    'sessions',
    `${role}-${sanitizedBranch}-${formatDate(date)}.md`,
  );
}

export async function createSessionLog(
  config: ColonyConfig,
  role: SessionRole,
  branch: string,
  issueNumber?: number,
): Promise<string> {
  const date = new Date();
  const logPath = buildLogPath(config, role, branch, date);
  const sessionsDir = path.dirname(logPath);

  await mkdir(sessionsDir, { recursive: true });

  const header = [
    `# ${role} 세션 기록서`,
    '',
    `- **브랜치**: ${branch}`,
    `- **시작 시각**: ${date.toISOString()}`,
    issueNumber ? `- **관련 Issue**: #${issueNumber}` : '',
    '',
    '---',
    '',
  ]
    .filter(Boolean)
    .join('\n');

  await writeFile(logPath, header, 'utf-8');
  return logPath;
}

async function appendLog(logPath: string, entry: SessionLogEntry): Promise<void> {
  const prefix = entry.type === 'sot-candidate' ? '[SSoT] ' : '';
  const line = `- \`${entry.timestamp}\` **[${entry.type}]** ${prefix}${entry.content}\n`;
  await appendFile(logPath, line, 'utf-8');
}

export async function appendLogEntry(
  logPath: string,
  type: SessionLogEntry['type'],
  content: string,
): Promise<void> {
  const entry: SessionLogEntry = {
    timestamp: formatTimestamp(new Date()),
    type,
    content,
  };
  await appendLog(logPath, entry);
}

export async function appendSessionSummary(logPath: string, summary: string): Promise<void> {
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
