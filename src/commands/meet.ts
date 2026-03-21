import { mkdir } from 'node:fs/promises';
import path from 'node:path';

import { loadConfig } from '../config.js';
import { logger } from '../core/logger.js';
import { createProvider } from '../core/provider.js';
import {
  buildLanguageDirective,
  buildToolingDirective,
  detectTooling,
  loadPromptFile,
  renderTemplate,
  waitForProcess,
} from '../core/session-spawner.js';

const MEETINGS_DIR = '.agent-hive/meetings';

function getArgValue(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return undefined;
  return args[idx + 1];
}

function formatDate(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function buildOutputPath(targetRepo: string, topic: string, date: string): string {
  return path.join(targetRepo, MEETINGS_DIR, `${date}-${topic}.md`);
}

export async function runMeet(args: string[]): Promise<void> {
  if (args.includes('--help')) {
    logger.info(`Usage: agent-hive meet [options]

Options:
  --topic <name>   Meeting topic (default: "general")
  --help           Show this help message

Examples:
  agent-hive meet
  agent-hive meet --topic auth-system
  agent-hive meet --topic v0.4-planning`);
    return;
  }

  const config = await loadConfig();
  const topic = getArgValue(args, '--topic') ?? 'general';
  const date = formatDate();
  const outputPath = buildOutputPath(config.targetRepo, topic, date);

  // Ensure meetings directory exists
  await mkdir(path.dirname(outputPath), { recursive: true });

  // Load and render the meet prompt
  const template = await loadPromptFile('meet.md');
  const tooling = await detectTooling(config.targetRepo);

  const prompt = renderTemplate(template, {
    repo: config.github.repo,
    'target-repo': config.targetRepo,
    topic,
    date,
    'output-path': outputPath,
    'language-directive': buildLanguageDirective(config.language),
    'tooling-directive': buildToolingDirective(tooling),
  });

  logger.info(`Starting PM meeting session...`, { topic, output: outputPath });

  const provider = createProvider(config.provider as 'claude' | 'codex');
  const child = provider.spawnSession(prompt, config.targetRepo);
  await waitForProcess(child);

  logger.info('Meeting session ended.', { notes: outputPath });
}
