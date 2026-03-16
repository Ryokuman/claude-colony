import { readFile, unlink } from 'node:fs/promises';
import { EventEmitter } from 'node:events';

import { watch, type FSWatcher } from 'chokidar';

import type { HiveEvent } from '../github/webhook-server.js';
import { HiveError } from './errors.js';

const EVENTS_DIR = '/tmp/hive-events';

export interface FileWatcherEvents {
  pr_opened: [event: HiveEvent];
  pr_comment: [event: HiveEvent];
  pr_closed: [event: HiveEvent];
  pr_merged: [event: HiveEvent];
  error: [error: Error];
}

export class HiveFileWatcher extends EventEmitter<FileWatcherEvents> {
  private watcher: FSWatcher | null = null;

  async start(): Promise<void> {
    this.watcher = watch(EVENTS_DIR, {
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 200,
        pollInterval: 50,
      },
    });

    this.watcher.on('add', (filePath) => {
      this.handleNewFile(filePath).catch((err) => {
        this.emit(
          'error',
          err instanceof Error ? err : new HiveError(String(err), 'FILE_WATCHER_ERROR'),
        );
      });
    });

    this.watcher.on('change', (filePath) => {
      this.handleNewFile(filePath).catch((err) => {
        this.emit(
          'error',
          err instanceof Error ? err : new HiveError(String(err), 'FILE_WATCHER_ERROR'),
        );
      });
    });
  }

  async stop(): Promise<void> {
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }
  }

  private async handleNewFile(filePath: string): Promise<void> {
    if (!filePath.endsWith('.json')) return;

    const content = await readFile(filePath, 'utf-8');
    const event = JSON.parse(content) as HiveEvent;

    this.emit(event.type, event);

    await unlink(filePath).catch(() => {});
  }
}

export function createFileWatcher(): HiveFileWatcher {
  return new HiveFileWatcher();
}
