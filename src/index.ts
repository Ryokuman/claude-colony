import { loadConfig } from './config.js';
import { initVault } from './obsidian/vault-init.js';
import { startWebhookServer } from './github/webhook-server.js';
import { createFileWatcher } from './core/file-watcher.js';
import { spawnReviewer, getActiveSessions, killSession } from './core/session-spawner.js';

async function main(): Promise<void> {
  console.log('claude-colony starting...');

  const config = await loadConfig();
  console.log(`Target repo: ${config.targetRepo}`);
  console.log(`Task manager: ${config.taskManager}`);

  if (config.obsidian.enabled) {
    await initVault(config);
    console.log(`Obsidian vault initialized: ${config.obsidian.vaultPath}`);
  }

  await startWebhookServer(config);

  const watcher = createFileWatcher();
  await watcher.start();
  console.log('File watcher started: /tmp/colony-events/');

  if (config.session.reviewerEnabled) {
    watcher.on('pr_opened', async (event) => {
      console.log(`PR #${event.prNumber} opened on ${event.branch}, spawning reviewer...`);
      await spawnReviewer(config, event.branch, event.prNumber);
    });
  }

  watcher.on('pr_comment', (event) => {
    console.log(`PR #${event.prNumber} new comment on ${event.branch}`);
  });

  watcher.on('pr_merged', (event) => {
    console.log(`PR #${event.prNumber} merged on ${event.branch}`);
  });

  watcher.on('pr_closed', (event) => {
    console.log(`PR #${event.prNumber} closed on ${event.branch}`);
  });

  watcher.on('error', (err) => {
    console.error('File watcher error:', err.message);
  });

  console.log('claude-colony ready. Waiting for events...');

  const shutdown = async (): Promise<void> => {
    console.log('\nShutting down...');

    const sessions = getActiveSessions();
    for (const session of sessions) {
      console.log(`Killing session: ${session.id}`);
      killSession(session.id);
    }

    await watcher.stop();
    process.exit(0);
  };

  process.on('SIGINT', () => {
    shutdown().catch(console.error);
  });
  process.on('SIGTERM', () => {
    shutdown().catch(console.error);
  });
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
