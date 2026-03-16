import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import type { ColonyConfig } from '../config.js';

const execFileAsync = promisify(execFile);

export interface PrInfo {
  number: number;
  title: string;
  state: 'open' | 'merged' | 'closed';
  branch: string;
  url: string;
}

export interface PrComment {
  id: number;
  body: string;
  author: string;
  createdAt: string;
}

async function gh(config: ColonyConfig, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('gh', args, {
    cwd: config.targetRepo,
    env: { ...process.env },
  });
  return stdout.trim();
}

function buildCreatePrArgs(
  repo: string,
  baseBranch: string,
  options: { title: string; body: string; base?: string; head: string },
): string[] {
  return [
    'pr',
    'create',
    '--repo',
    repo,
    '--title',
    options.title,
    '--body',
    options.body,
    '--head',
    options.head,
    '--base',
    options.base ?? baseBranch,
    '--json',
    'number,title,state,headRefName,url',
  ];
}

export async function createPr(
  config: ColonyConfig,
  options: {
    title: string;
    body: string;
    base?: string;
    head: string;
  },
): Promise<PrInfo> {
  const args = buildCreatePrArgs(config.github.repo, config.github.baseBranch, options);
  const output = await gh(config, args);
  const data = JSON.parse(output) as {
    number: number;
    title: string;
    state: string;
    headRefName: string;
    url: string;
  };

  return {
    number: data.number,
    title: data.title,
    state: data.state as PrInfo['state'],
    branch: data.headRefName,
    url: data.url,
  };
}

export async function getPrStatus(config: ColonyConfig, prNumber: number): Promise<PrInfo> {
  const output = await gh(config, [
    'pr',
    'view',
    String(prNumber),
    '--repo',
    config.github.repo,
    '--json',
    'number,title,state,headRefName,url',
  ]);

  const data = JSON.parse(output) as {
    number: number;
    title: string;
    state: string;
    headRefName: string;
    url: string;
  };

  return {
    number: data.number,
    title: data.title,
    state: data.state as PrInfo['state'],
    branch: data.headRefName,
    url: data.url,
  };
}

export async function addPrComment(
  config: ColonyConfig,
  prNumber: number,
  body: string,
): Promise<void> {
  await gh(config, [
    'pr',
    'comment',
    String(prNumber),
    '--repo',
    config.github.repo,
    '--body',
    body,
  ]);
}

export async function getPrComments(config: ColonyConfig, prNumber: number): Promise<PrComment[]> {
  const output = await gh(config, [
    'api',
    `repos/${config.github.repo}/issues/${prNumber}/comments`,
    '--jq',
    '.[].id, .[].body, .[].user.login, .[].created_at',
  ]);

  if (!output) return [];

  const rawOutput = await gh(config, [
    'api',
    `repos/${config.github.repo}/issues/${prNumber}/comments`,
  ]);

  const data = JSON.parse(rawOutput) as Array<{
    id: number;
    body: string;
    user: { login: string };
    created_at: string;
  }>;

  return data.map((c) => ({
    id: c.id,
    body: c.body,
    author: c.user.login,
    createdAt: c.created_at,
  }));
}
