import type { ChildProcess } from 'node:child_process';
import { readFile, unlink } from 'node:fs/promises';
import path from 'node:path';

import type { HiveConfig } from '../config.js';
import { HiveError } from './errors.js';
import { logger } from './logger.js';
import { createProvider } from './provider.js';

const MAX_REVIEW_ROUNDS = 10;

export interface LeadSessionOptions {
  config: HiveConfig;
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

function buildVaultSection(config: HiveConfig): string {
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

function buildTemplateVars(options: LeadSessionOptions): Record<string, string> {
  return {
    repo: options.config.github.repo,
    'target-repo': options.config.targetRepo,
    'base-branch': options.config.github.baseBranch,
    'issue-number': String(options.issueNumber),
    'issue-title': options.issueTitle,
    'issue-body': options.issueBody,
    'vault-section': buildVaultSection(options.config),
  };
}

function waitForProcess(child: ChildProcess): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    child.on('error', (err) =>
      reject(new HiveError(`Process failed: ${err.message}`, 'SESSION_ERROR')),
    );
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new HiveError(`Process exited with code ${code}`, 'SESSION_ERROR'));
    });
  });
}

async function spawnClaudeSession(options: LeadSessionOptions): Promise<void> {
  const [leadTemplate, workerRules, reviewerRules] = await Promise.all([
    loadPromptFile('lead.md'),
    loadPromptFile('worker.md'),
    loadPromptFile('reviewer.md'),
  ]);

  const vars = buildTemplateVars(options);
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
    (feedback ? `\n\n## 이전 리뷰 피드백\n\n${feedback}` : '') +
    `\n\n## 작업 지시\n이슈 #${options.issueNumber} "${options.issueTitle}"를 구현하세요.\n${options.issueBody}`
  );
}

function buildReviewerPrompt(
  template: string,
  vars: Record<string, string>,
  issueNumber: number,
): string {
  return (
    renderTemplate(template, vars) +
    `\n\n## 리뷰 지시\n이슈 #${issueNumber}에 대한 최신 변경사항을 리뷰하세요.\n리뷰 결과를 /tmp/agent-hive-review-${issueNumber}.json 에 JSON으로 저장하세요.\n형식: {"approved": true/false, "feedback": "피드백 내용"}`
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

  const vars = buildTemplateVars(options);
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
    const reviewerPrompt = buildReviewerPrompt(reviewerTemplate, vars, options.issueNumber);
    await waitForProcess(provider.spawnSession(reviewerPrompt, options.config.targetRepo));

    const review = await readReviewResult(reviewPath, prefix);
    if (review.approved) {
      logger.info(`${prefix} Reviewer approved after ${round} round(s).`);
      return;
    }
    feedback = review.feedback;
    logger.info(`${prefix} Reviewer requested changes: ${feedback}`);
  }

  throw new HiveError(
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
