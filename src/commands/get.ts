import { loadConfig } from '../config.js';
import { GithubError } from '../core/errors.js';
import { logger } from '../core/logger.js';
import { spawnLeadSession } from '../core/session-spawner.js';
import { getIssue } from '../github/issues.js';
import { initVault } from '../obsidian/vault-init.js';

function parseIssueRef(input: string): string {
  const urlMatch = input.match(/github\.com\/[\w.-]+\/[\w.-]+\/issues\/(\d+)/);
  if (urlMatch) return urlMatch[1];

  const shortMatch = input.match(/^[\w.-]+\/[\w.-]+#(\d+)$/);
  if (shortMatch) return shortMatch[1];

  if (/^\d+$/.test(input)) return input;
  if (/^#\d+$/.test(input)) return input.slice(1);

  throw new GithubError(`Invalid issue reference: ${input}`);
}

function getArgValue(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return undefined;
  return args[idx + 1];
}

export async function runGet(args: string[]): Promise<void> {
  // Collect flag values
  const providerArg = getArgValue(args, '--provider');

  // Filter out flags and their values to get issue refs
  const flagsWithValues = new Set(['--provider']);
  const issueRefs: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (flagsWithValues.has(args[i])) {
      i++; // skip the value
      continue;
    }
    if (args[i].startsWith('--')) continue;
    issueRefs.push(args[i]);
  }

  if (issueRefs.length === 0) {
    throw new GithubError('Usage: claude-colony get <issue-number-or-url> [issue2 ...]');
  }

  const config = await loadConfig();

  if (providerArg) {
    config.provider = providerArg;
  }

  if (config.obsidian) {
    await initVault(config);
  }

  await Promise.all(
    issueRefs.map(async (ref) => {
      const issueNumber = parseIssueRef(ref);
      const issue = await getIssue(config, issueNumber);

      logger.info(`[Issue #${issue.number}] ${issue.title}`);

      await spawnLeadSession({
        config,
        issueNumber: issue.number,
        issueTitle: issue.title,
        issueBody: issue.body,
      });
    }),
  );
}
