#!/usr/bin/env node

import { logger } from './core/logger.js';
import { ColonyError } from './core/errors.js';

const USAGE_TEXT = `Usage: claude-colony <command> [options]

Commands:
  init    Initialize a new colony project
  start   Start the colony system

Options:
  --help  Show this help message

Init options:
  --repo <owner/repo>        GitHub repository (required)
  --target-repo <path>       Path to local repository (required)
  --token <token>            GitHub personal access token (required)
  --webhook-secret <secret>  Webhook secret (optional)
  --base-branch <branch>     Base branch name (default: main)
  --obsidian-vault <path>    Obsidian vault path (optional)
  --webhook-port <port>      Webhook server port (default: 4001)
  --dashboard-port <port>    Dashboard port (default: 4000)`;

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

  if (command === 'start') {
    const { main } = await import('./index.js');
    await main();
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
