import { spawn, type ChildProcess } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import type { ColonyConfig } from '../config.js';
import { logger } from './logger.js';
import {
  SessionRole,
  createSessionLog,
  appendLogEntry,
  appendSessionSummary,
} from './session-logger.js';

export interface SessionInfo {
  id: string;
  role: SessionRole;
  branch: string;
  prNumber?: number;
  process: ChildProcess;
  logPath: string;
  startedAt: Date;
}

const activeSessions = new Map<string, SessionInfo>();

function generateSessionId(role: SessionRole, branch: string): string {
  const sanitized = branch.replace(/\//g, '-');
  return `${role}-${sanitized}-${Date.now()}`;
}

async function loadPromptTemplate(role: SessionRole): Promise<string> {
  const templatePath = path.join(
    import.meta.dirname ?? '.',
    '..',
    'prompts',
    `${role === SessionRole.Worker ? 'worker' : 'reviewer'}.md`,
  );
  return readFile(templatePath, 'utf-8');
}

function renderTemplate(template: string, vars: Record<string, string>): string {
  let result = template;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replaceAll(`{${key}}`, value);
  }
  return result;
}

function startSessionProcess(
  config: ColonyConfig,
  prompt: string,
  role: SessionRole,
  branch: string,
  logPath: string,
  prNumber?: number,
): SessionInfo {
  const child = spawn('claude', ['-p', prompt], {
    cwd: config.targetRepo,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  const sessionId = generateSessionId(role, branch);
  const session: SessionInfo = {
    id: sessionId,
    role,
    branch,
    prNumber,
    process: child,
    logPath,
    startedAt: new Date(),
  };

  activeSessions.set(sessionId, session);

  child.on('exit', (code) => {
    handleSessionExit(sessionId, code).catch((err) =>
      logger.error('Session exit handling failed', { error: String(err) }),
    );
  });

  return session;
}

async function spawnSession(
  config: ColonyConfig,
  role: SessionRole,
  branch: string,
  templateVars: Record<string, string>,
  logMessage: string,
  prNumber?: number,
  issueNumber?: number,
): Promise<SessionInfo> {
  const template = await loadPromptTemplate(role);
  const prompt = renderTemplate(template, {
    branch,
    date: new Date().toISOString().slice(0, 10),
    'target-repo': config.targetRepo,
    'vault-path': config.obsidian.vaultPath,
    ...templateVars,
  });

  const logPath = await createSessionLog(config, role, branch, issueNumber);
  await appendLogEntry(logPath, 'note', logMessage);

  return startSessionProcess(config, prompt, role, branch, logPath, prNumber);
}

export async function spawnWorker(
  config: ColonyConfig,
  branch: string,
  issueNumber?: number,
): Promise<SessionInfo> {
  return spawnSession(
    config,
    SessionRole.Worker,
    branch,
    { 'pr-number': '' },
    `워커 세션 시작: branch=${branch}`,
    undefined,
    issueNumber,
  );
}

export async function spawnReviewer(
  config: ColonyConfig,
  branch: string,
  prNumber: number,
): Promise<SessionInfo> {
  return spawnSession(
    config,
    SessionRole.Reviewer,
    branch,
    { 'pr-number': String(prNumber) },
    `리뷰어 세션 시작: PR #${prNumber}, branch=${branch}`,
    prNumber,
  );
}

async function handleSessionExit(sessionId: string, code: number | null): Promise<void> {
  const session = activeSessions.get(sessionId);
  if (!session) return;

  await appendSessionSummary(session.logPath, `세션 종료 (exit code: ${code ?? 'unknown'})`);

  activeSessions.delete(sessionId);
}

export function getActiveSessions(): SessionInfo[] {
  return Array.from(activeSessions.values());
}

export function getSession(sessionId: string): SessionInfo | undefined {
  return activeSessions.get(sessionId);
}

export function killSession(sessionId: string): boolean {
  const session = activeSessions.get(sessionId);
  if (!session) return false;

  session.process.kill('SIGTERM');
  return true;
}
