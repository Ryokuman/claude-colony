import type { ColonyConfig } from '../config.js';
import { createAdapter } from '../adapters/adapter-factory.js';

export interface IssueSource {
  getIssue(ref: string): Promise<{ number: number; title: string; body: string }>;
}

export function createIssueSource(config: ColonyConfig): IssueSource {
  const adapter = createAdapter(config.adapter, config.targetRepo);

  return {
    async getIssue(ref: string) {
      const issue = await adapter.get(ref);
      return { number: issue.number, title: issue.title, body: issue.body };
    },
  };
}
