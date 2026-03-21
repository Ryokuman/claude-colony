#!/usr/bin/env node

import { logger } from './core/logger.js';
import { ColonyError } from './core/errors.js';

const USAGE_TEXT = `Usage: agent-hive <command> [options]

Commands:
  init                         Initialize a new colony project
  meet                         Start a PM meeting session
  worktree create              Create a worktree and spawn agents for issues
  worktree list                List active worktrees
  worktree clean               Remove completed worktrees
  status [issue]               Show issue tracking status
  issue <subcommand>           Issue management (via adapter)
  pr <subcommand>              Pull request management (GitHub)

Options:
  --help  Show this help message

Init options:
  --repo <owner/repo>          GitHub repository (required)
  --target-repo <path>         Path to local repository (required)
  --base-branch <branch>       Base branch name (default: main)
  --provider <claude|codex>    AI provider (default: claude)
  --language <lang>            Review language (default: en)
  --obsidian-vault <path>      Obsidian vault path (optional)
  --worktree-auto-clean        Auto-clean worktrees on completion

Meet options:
  --topic <name>               Meeting topic (default: "general")

Worktree create options:
  --branch <name>              Branch name (required)
  --provider <claude|codex>    AI provider override
  <issue refs>                 Issue numbers (#42 43 owner/repo#44 URL)

Issue subcommands:
  issue get <ref>              Get issue details
  issue list [--state ...] [--label ...]  List issues
  issue create --title "..." --body "..." [--label ...]  Create issue
  issue update <ref> [--title ...] [--body ...] [--state ...]  Update issue
  issue label <ref> --add/--remove <label>  Manage labels
  issue close <ref>            Close issue

PR subcommands:
  pr create --title "..." --body "..." --head <branch> [--base ...]  Create PR
  pr status <number>           Get PR status
  pr comment <number> --body "..."  Add comment to PR

Examples:
  agent-hive meet --topic auth-system
  agent-hive worktree create --branch feat/auth #42 #43
  agent-hive worktree list
  agent-hive worktree clean
  agent-hive status
  agent-hive status #42
  agent-hive issue get 42
  agent-hive issue create --title "Bug fix" --body "Details"
  agent-hive pr create --title "feat: auth" --body "closes #42" --head feat/auth`;

function parseCommand(args: string[]): string[] {
  const commands: string[] = [];
  for (const a of args) {
    if (a.startsWith('--')) break;
    commands.push(a);
  }
  return commands;
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

  const commands = parseCommand(args);

  if (commands[0] === 'init') {
    const { runInit } = await import('./commands/init.js');
    await runInit(args);
    return;
  }

  if (commands[0] === 'meet') {
    const { runMeet } = await import('./commands/meet.js');
    await runMeet(args);
    return;
  }

  if (commands[0] === 'worktree') {
    if (commands[1] === 'create') {
      const { runWorktreeCreate } = await import('./commands/worktree.js');
      await runWorktreeCreate(args);
      return;
    }
    if (commands[1] === 'list') {
      const { runWorktreeList } = await import('./commands/worktree.js');
      await runWorktreeList();
      return;
    }
    if (commands[1] === 'clean') {
      const { runWorktreeClean } = await import('./commands/worktree.js');
      await runWorktreeClean();
      return;
    }
    logger.error('Unknown worktree subcommand. Use: create, list, clean');
    process.exit(1);
  }

  if (commands[0] === 'status') {
    const { runStatus } = await import('./commands/status.js');
    await runStatus(args);
    return;
  }

  if (commands[0] === 'issue') {
    const { runIssue } = await import('./commands/issue.js');
    await runIssue(args);
    return;
  }

  if (commands[0] === 'pr') {
    const { runPr } = await import('./commands/pr.js');
    await runPr(args);
    return;
  }

  logger.error(`Unknown command: ${commands[0]}`);
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
