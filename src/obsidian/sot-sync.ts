import { readFile, appendFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

import type { ColonyConfig } from '../config.js';

const SSoT_TAG = '[SSoT]';
const DECISION_TAG = '[DECISION]';

export interface SotEntry {
  content: string;
  source: string;
  timestamp: string;
}

function extractTaggedLines(content: string, tag: string): string[] {
  return content
    .split('\n')
    .filter((line) => line.includes(tag))
    .map((line) => line.replace(new RegExp(`\\*\\*\\${tag}\\*\\*\\s*`, 'g'), '').trim())
    .map((line) => line.replace(/^-\s*`\d{2}:\d{2}:\d{2}`\s*/, ''));
}

export function extractSotCandidates(logContent: string): string[] {
  const ssotLines = extractTaggedLines(logContent, SSoT_TAG);
  const decisionLines = extractTaggedLines(logContent, DECISION_TAG);
  return [...ssotLines, ...decisionLines];
}

export async function syncToClaudeMd(config: ColonyConfig, entries: SotEntry[]): Promise<void> {
  if (!config.obsidian.enabled || entries.length === 0) return;

  const claudeMdPath = path.join(config.obsidian.vaultPath, 'context', 'CLAUDE.md');

  const existing = await readFile(claudeMdPath, 'utf-8').catch(() => '');

  const newSection = [
    '',
    `### 업데이트 (${new Date().toISOString().slice(0, 10)})`,
    '',
    ...entries.map((e) => `- ${e.content} _(출처: ${e.source})_`),
    '',
  ].join('\n');

  await appendFile(claudeMdPath, newSection, 'utf-8');
}

export async function syncToSpec(
  config: ColonyConfig,
  topic: string,
  content: string,
): Promise<void> {
  if (!config.obsidian.enabled) return;

  const specDir = path.join(config.obsidian.vaultPath, 'spec');
  await mkdir(specDir, { recursive: true });

  const sanitizedTopic = topic.replace(/[^a-zA-Z0-9가-힣\-_]/g, '-').toLowerCase();
  const specPath = path.join(specDir, `${sanitizedTopic}.md`);

  const existing = await readFile(specPath, 'utf-8').catch(() => '');

  if (existing) {
    const update = [
      '',
      `---`,
      '',
      `## 업데이트 (${new Date().toISOString().slice(0, 10)})`,
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

export async function promoteFromSessionLog(
  config: ColonyConfig,
  logPath: string,
): Promise<SotEntry[]> {
  if (!config.obsidian.enabled) return [];

  const logContent = await readFile(logPath, 'utf-8');
  const candidates = extractSotCandidates(logContent);

  if (candidates.length === 0) return [];

  const source = path.basename(logPath);
  const entries: SotEntry[] = candidates.map((content) => ({
    content,
    source,
    timestamp: new Date().toISOString(),
  }));

  await syncToClaudeMd(config, entries);

  return entries;
}
