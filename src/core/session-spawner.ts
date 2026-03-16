import type { ChildProcess } from 'node:child_process';
import { access, readFile, unlink } from 'node:fs/promises';
import path from 'node:path';

import type { ColonyConfig } from '../config.js';
import { ColonyError } from './errors.js';
import { logger } from './logger.js';
import { createProvider } from './provider.js';

const MAX_REVIEW_ROUNDS = 10;

export interface LeadSessionOptions {
  config: ColonyConfig;
  issueNumber: number;
  issueTitle: string;
  issueBody: string;
}

async function loadPromptFile(filename: string): Promise<string> {
  const filePath = path.join(import.meta.dirname ?? '.', '..', 'prompts', filename);
  return readFile(filePath, 'utf-8');
}

function renderTemplate(template: string, vars: Record<string, string>): string {
  let result = template;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replaceAll(`{${key}}`, value);
  }
  return result;
}

function buildVaultSection(config: ColonyConfig): string {
  if (!config.obsidian) {
    return 'Obsidian vault는 비활성화 상태입니다.';
  }

  return [
    `Vault 경로: ${config.obsidian.vaultPath}`,
    '- 작업 기록은 vault/sessions/ 에 저장한다.',
    '- 컨벤션/패턴은 vault/context/CLAUDE.md 를 참조한다.',
    '- 중요 결정사항은 [SSoT] 태그로 기록하여 승격 대상으로 표시한다.',
  ].join('\n');
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

interface DetectedTooling {
  formatter: string | null;
  linter: string | null;
  conventions: string | null;
}

async function detectTooling(targetRepo: string): Promise<DetectedTooling> {
  const checks = await Promise.all([
    fileExists(path.join(targetRepo, '.prettierrc')),
    fileExists(path.join(targetRepo, '.prettierrc.json')),
    fileExists(path.join(targetRepo, '.prettierrc.js')),
    fileExists(path.join(targetRepo, 'prettier.config.js')),
    fileExists(path.join(targetRepo, '.eslintrc')),
    fileExists(path.join(targetRepo, '.eslintrc.json')),
    fileExists(path.join(targetRepo, '.eslintrc.js')),
    fileExists(path.join(targetRepo, 'eslint.config.js')),
    fileExists(path.join(targetRepo, 'eslint.config.mjs')),
    fileExists(path.join(targetRepo, 'biome.json')),
    fileExists(path.join(targetRepo, 'CLAUDE.md')),
    fileExists(path.join(targetRepo, '.claude', 'settings.json')),
  ]);

  const hasPrettier = checks[0] || checks[1] || checks[2] || checks[3];
  const hasEslint = checks[4] || checks[5] || checks[6] || checks[7] || checks[8];
  const hasBiome = checks[9];
  const hasClaudeMd = checks[10] || checks[11];

  let formatter: string | null = null;
  if (hasBiome) formatter = 'npx biome format --write .';
  else if (hasPrettier) formatter = 'npx prettier --write .';

  let linter: string | null = null;
  if (hasBiome) linter = 'npx biome check --fix .';
  else if (hasEslint) linter = 'npx eslint --fix .';

  const conventions = hasClaudeMd ? 'CLAUDE.md' : null;

  return { formatter, linter, conventions };
}

function buildToolingDirective(tooling: DetectedTooling): string {
  const lines: string[] = [];

  if (!tooling.formatter && !tooling.linter && !tooling.conventions) {
    return '';
  }

  lines.push('\n\n## Project Tooling (auto-detected)');

  if (tooling.conventions) {
    lines.push(`- Read \`${tooling.conventions}\` at the project root for conventions and patterns.`);
  }

  if (tooling.formatter) {
    lines.push(`- Before committing, run formatter: \`${tooling.formatter}\``);
  }

  if (tooling.linter) {
    lines.push(`- Before committing, run linter: \`${tooling.linter}\``);
  }

  lines.push('');
  return lines.join('\n');
}

function buildLanguageDirective(language: string): string {
  if (language === 'en') return '';
  return `\n\n## Language\n\nAll responses, comments, PR descriptions, and review feedback MUST be written in: ${language}\n`;
}

async function buildTemplateVars(options: LeadSessionOptions): Promise<Record<string, string>> {
  const tooling = await detectTooling(options.config.targetRepo);

  return {
    repo: options.config.github.repo,
    'target-repo': options.config.targetRepo,
    'base-branch': options.config.github.baseBranch,
    'issue-number': String(options.issueNumber),
    'issue-title': options.issueTitle,
    'issue-body': options.issueBody,
    'vault-section': buildVaultSection(options.config),
    'language-directive': buildLanguageDirective(options.config.language),
    'tooling-directive': buildToolingDirective(tooling),
  };
}

function waitForProcess(child: ChildProcess): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    child.on('error', (err) =>
      reject(new ColonyError(`Process failed: ${err.message}`, 'SESSION_ERROR')),
    );
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new ColonyError(`Process exited with code ${code}`, 'SESSION_ERROR'));
    });
  });
}

async function spawnClaudeSession(options: LeadSessionOptions): Promise<void> {
  const [leadTemplate, workerRules, reviewerRules] = await Promise.all([
    loadPromptFile('lead.md'),
    loadPromptFile('worker.md'),
    loadPromptFile('reviewer.md'),
  ]);

  const vars = await buildTemplateVars(options);
  const prompt = renderTemplate(leadTemplate, {
    ...vars,
    'worker-rules': workerRules,
    'reviewer-rules': reviewerRules,
  });

  const provider = createProvider('claude');
  const child = provider.spawnSession(prompt, options.config.targetRepo);
  await waitForProcess(child);
}

function buildWorkerPrompt(
  template: string,
  vars: Record<string, string>,
  options: LeadSessionOptions,
  feedback: string,
): string {
  return (
    renderTemplate(template, vars) +
    (vars['tooling-directive'] ?? '') +
    buildLanguageDirective(options.config.language) +
    (feedback ? `\n\n## 이전 리뷰 피드백\n\n${feedback}` : '') +
    `\n\n## 작업 지시\n이슈 #${options.issueNumber} "${options.issueTitle}"를 구현하세요.\n${options.issueBody}`
  );
}

function buildReviewerPrompt(
  template: string,
  vars: Record<string, string>,
  options: LeadSessionOptions,
): string {
  return (
    renderTemplate(template, vars) +
    (vars['tooling-directive'] ?? '') +
    buildLanguageDirective(options.config.language) +
    `\n\n## 리뷰 지시\n이슈 #${options.issueNumber}에 대한 최신 변경사항을 리뷰하세요.\n리뷰 결과를 /tmp/agent-hive-review-${options.issueNumber}.json 에 JSON으로 저장하세요.\n형식: {"approved": true/false, "feedback": "피드백 내용"}`
  );
}

async function readReviewResult(
  reviewPath: string,
  prefix: string,
): Promise<{ approved: boolean; feedback: string }> {
  try {
    const reviewContent = await readFile(reviewPath, 'utf-8');
    return JSON.parse(reviewContent) as { approved: boolean; feedback: string };
  } catch {
    logger.warn(`${prefix} Could not read review result, assuming not approved.`);
    return {
      approved: false,
      feedback: 'Review result file not found. Please review and try again.',
    };
  }
}

async function spawnCodexSession(options: LeadSessionOptions): Promise<void> {
  const [workerTemplate, reviewerTemplate] = await Promise.all([
    loadPromptFile('worker.md'),
    loadPromptFile('reviewer.md'),
  ]);

  const vars = await buildTemplateVars(options);
  const provider = createProvider('codex');
  const prefix = `[Issue #${options.issueNumber}]`;
  const reviewPath = `/tmp/agent-hive-review-${options.issueNumber}.json`;

  let feedback = '';

  for (let round = 1; round <= MAX_REVIEW_ROUNDS; round++) {
    logger.info(`${prefix} Round ${round}: Worker starting...`);
    const workerPrompt = buildWorkerPrompt(workerTemplate, vars, options, feedback);
    await waitForProcess(provider.spawnSession(workerPrompt, options.config.targetRepo));

    logger.info(`${prefix} Round ${round}: Reviewer starting...`);
    // Clean up stale review file before spawning reviewer
    await unlink(reviewPath).catch(() => {});
    const reviewerPrompt = buildReviewerPrompt(reviewerTemplate, vars, options);
    await waitForProcess(provider.spawnSession(reviewerPrompt, options.config.targetRepo));

    const review = await readReviewResult(reviewPath, prefix);
    if (review.approved) {
      logger.info(`${prefix} Reviewer approved after ${round} round(s).`);
      return;
    }
    feedback = review.feedback;
    logger.info(`${prefix} Reviewer requested changes: ${feedback}`);
  }

  throw new ColonyError(
    `${prefix} Exceeded maximum review rounds (${MAX_REVIEW_ROUNDS})`,
    'SESSION_ERROR',
  );
}

export async function spawnLeadSession(options: LeadSessionOptions): Promise<void> {
  const provider = options.config.provider ?? 'claude';

  logger.info(`Spawning lead session with provider: ${provider}`, {
    issue: `#${options.issueNumber}`,
    repo: options.config.github.repo,
  });

  if (provider === 'codex') {
    return spawnCodexSession(options);
  }

  return spawnClaudeSession(options);
}
