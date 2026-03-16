import type { HiveConfig } from './config.js';
import { loadConfig } from './config.js';
import { type HiveFileWatcher, createFileWatcher } from './core/file-watcher.js';
import { logger } from './core/logger.js';
import { spawnReviewer, getActiveSessions, killSession } from './core/session-spawner.js';
import { startWebhookServer } from './github/webhook-server.js';
import { initVault } from './obsidian/vault-init.js';

function setupEventHandlers(config: HiveConfig, watcher: HiveFileWatcher): void {
  if (config.session.reviewerEnabled) {
    watcher.on('pr_opened', async (event) => {
      logger.info(`PR #${event.prNumber} opened on ${event.branch}, spawning reviewer...`);
      await spawnReviewer(config, event.branch, event.prNumber);
    });
  }

  watcher.on('pr_comment', (event) => {
    logger.info(`PR #${event.prNumber} new comment on ${event.branch}`);
  });

  watcher.on('pr_merged', (event) => {
    logger.info(`PR #${event.prNumber} merged on ${event.branch}`);
  });

  watcher.on('pr_closed', (event) => {
    logger.info(`PR #${event.prNumber} closed on ${event.branch}`);
  });

  watcher.on('error', (err) => {
    logger.error('File watcher error:', { error: err.message });
  });
}

function setupShutdown(watcher: HiveFileWatcher): void {
  const shutdown = async (): Promise<void> => {
    logger.info('Shutting down...');

    const sessions = getActiveSessions();
    for (const session of sessions) {
      logger.info(`Killing session: ${session.id}`);
      killSession(session.id);
    }

    await watcher.stop();
    process.exit(0);
  };

  process.on('SIGINT', () => {
    shutdown().catch((err) => logger.error('Shutdown error', { error: String(err) }));
  });
  process.on('SIGTERM', () => {
    shutdown().catch((err) => logger.error('Shutdown error', { error: String(err) }));
  });
}

export async function main(): Promise<void> {
  logger.info('agent-hive starting...');

  const config = await loadConfig();
  logger.info(`Target repo: ${config.targetRepo}`);
  logger.info(`Task manager: ${config.taskManager}`);

  if (config.obsidian.enabled) {
    await initVault(config);
    logger.info(`Obsidian vault initialized: ${config.obsidian.vaultPath}`);
  }

  await startWebhookServer(config);

  const watcher = createFileWatcher();
  await watcher.start();
  logger.info('File watcher started: /tmp/hive-events/');

  setupEventHandlers(config, watcher);
  setupShutdown(watcher);

  logger.info('agent-hive ready. Waiting for events...');
}
