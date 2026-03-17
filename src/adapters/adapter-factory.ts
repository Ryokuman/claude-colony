import { ConfigError } from '../core/errors.js';
import type { AdapterConfig, IssueAdapter } from './types.js';
import { GithubAdapter } from './github-adapter.js';
import { JiraAdapter } from './jira-adapter.js';
import { LocalAdapter } from './local-adapter.js';
import { NotionAdapter } from './notion-adapter.js';
import { ObsidianAdapter } from './obsidian-adapter.js';

export function createAdapter(adapterConfig: AdapterConfig, targetRepo: string): IssueAdapter {
  switch (adapterConfig.type) {
    case 'github': {
      if (!adapterConfig.github?.repo) {
        throw new ConfigError('adapter.github.repo is required for GitHub adapter');
      }
      return new GithubAdapter(adapterConfig.github, targetRepo);
    }
    case 'jira': {
      if (!adapterConfig.jira) {
        throw new ConfigError('adapter.jira config is required for Jira adapter');
      }
      if (!adapterConfig.jira.host) {
        throw new ConfigError('adapter.jira.host is required for Jira adapter');
      }
      if (!adapterConfig.jira.projectKey) {
        throw new ConfigError('adapter.jira.projectKey is required for Jira adapter');
      }
      if (!adapterConfig.jira.email) {
        throw new ConfigError('adapter.jira.email is required for Jira adapter');
      }
      return new JiraAdapter(adapterConfig.jira);
    }
    case 'notion': {
      if (!adapterConfig.notion) {
        throw new ConfigError('adapter.notion config is required for Notion adapter');
      }
      return new NotionAdapter(adapterConfig.notion);
    }
    case 'obsidian': {
      if (!adapterConfig.obsidian) {
        throw new ConfigError('adapter.obsidian config is required for Obsidian adapter');
      }
      return new ObsidianAdapter(adapterConfig.obsidian);
    }
    case 'local': {
      return new LocalAdapter(adapterConfig.local, targetRepo);
    }
    default:
      throw new ConfigError(`Unknown adapter type: ${adapterConfig.type}`);
  }
}
