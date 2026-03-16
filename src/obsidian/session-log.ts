import { mkdir, appendFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { ColonyConfig } from '../config.js';

export interface SessionLogOptions {
  role: 'worker' | 'reviewer';
  branch: string;
  issueNumber?: number;
  prNumber?: number;
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function buildLogPath(config: ColonyConfig, options: SessionLogOptions): string {
  const sanitizedBranch = options.branch.replace(/\//g, '-');
  return path.join(
    config.obsidian.vaultPath,
    'sessions',
    `${options.role}-${sanitizedBranch}-${formatDate(new Date())}.md`,
  );
}

export async function createLog(config: ColonyConfig, options: SessionLogOptions): Promise<string> {
  if (!config.obsidian.enabled) {
    throw new Error('Obsidian is not enabled');
  }

  const logPath = buildLogPath(config, options);
  const sessionsDir = path.dirname(logPath);

  await mkdir(sessionsDir, { recursive: true });

  const lines = [
    `# ${options.role} 세션 기록서`,
    '',
    `- **브랜치**: ${options.branch}`,
    `- **시작 시각**: ${new Date().toISOString()}`,
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

export async function append(logPath: string, content: string): Promise<void> {
  const timestamp = new Date().toISOString().slice(11, 19);
  const line = `- \`${timestamp}\` ${content}\n`;
  await appendFile(logPath, line, 'utf-8');
}

export async function appendDecision(logPath: string, decision: string): Promise<void> {
  await append(logPath, `**[DECISION]** ${decision}`);
}

export async function appendSotCandidate(logPath: string, content: string): Promise<void> {
  await append(logPath, `**[SSoT]** ${content}`);
}

export async function appendBlocker(logPath: string, reason: string, issueNumber: number): Promise<void> {
  await append(logPath, `**[BLOCKER]** ${reason} (Issue #${issueNumber})`);
}

export async function closeSummary(logPath: string, summary: string): Promise<void> {
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
