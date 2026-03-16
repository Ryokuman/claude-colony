#!/usr/bin/env node

import { logger } from './core/logger.js';
import { ColonyError } from './core/errors.js';

const USAGE_TEXT = `Usage: claude-colony <command> [options]

Commands:
  init          Initialize a new colony project
  get <issue>   Fetch a GitHub issue and spawn a Worker+Reviewer team

Options:
  --help  Show this help message

Init options:
  --repo <owner/repo>        GitHub repository (required)
  --target-repo <path>       Path to local repository (required)
  --base-branch <branch>     Base branch name (default: main)
  --obsidian-vault <path>    Obsidian vault path (optional)
  --provider <claude|codex>  AI provider (default: claude)

Get options:
  --provider <claude|codex>  AI provider (default: claude)

Get examples:
  claude-colony get 42
  claude-colony get #42 #43 #44
  claude-colony get --provider codex 42
  claude-colony get https://github.com/owner/repo/issues/42`;

function parseCommand(args: string[]): string | undefined {
  const positional = args.filter((a) => !a.startsWith('--'));
  return positional[0];
}

function hasFlag(args: string[], flag: string): boolean {
  return args.includes(flag);
}

async function run(): Promise<void> {
  const args = process.argv.slice(2);

  if (hasFlag(args, '--help') || args.length === 0) {
    logger.info(USAGE_TEXT);
    return;
  }

  const command = parseCommand(args);

  if (command === 'init') {
    const { runInit } = await import('./commands/init.js');
    await runInit(args);
    return;
  }

  if (command === 'get') {
    const { runGet } = await import('./commands/get.js');
    const getArgs = args.filter((a) => a !== 'get');
    await runGet(getArgs);
    return;
  }

  logger.error(`Unknown command: ${command}`);
  logger.info(USAGE_TEXT);
  process.exit(1);
}

run().catch((err: unknown) => {
  if (err instanceof ColonyError) {
    logger.error(err.message, { code: err.code });
  } else {
    logger.error('Fatal error', { error: String(err) });
  }
  process.exit(1);
});
