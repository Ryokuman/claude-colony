import { readFile, unlink } from 'node:fs/promises';
import { EventEmitter } from 'node:events';

import { watch, type FSWatcher } from 'chokidar';

import type { ColonyEvent } from '../github/webhook-server.js';
import { ColonyError } from './errors.js';

const EVENTS_DIR = '/tmp/colony-events';

export interface FileWatcherEvents {
  pr_opened: [event: ColonyEvent];
  pr_comment: [event: ColonyEvent];
  pr_closed: [event: ColonyEvent];
  pr_merged: [event: ColonyEvent];
  error: [error: Error];
}

export class ColonyFileWatcher extends EventEmitter<FileWatcherEvents> {
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
          err instanceof Error ? err : new ColonyError(String(err), 'FILE_WATCHER_ERROR'),
        );
      });
    });

    this.watcher.on('change', (filePath) => {
      this.handleNewFile(filePath).catch((err) => {
        this.emit(
          'error',
          err instanceof Error ? err : new ColonyError(String(err), 'FILE_WATCHER_ERROR'),
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
    const event = JSON.parse(content) as ColonyEvent;

    this.emit(event.type, event);

    await unlink(filePath).catch(() => {});
  }
}

export function createFileWatcher(): ColonyFileWatcher {
  return new ColonyFileWatcher();
}
