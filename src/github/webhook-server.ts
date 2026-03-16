import { createHmac, timingSafeEqual } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import express, { type Request, type Response } from 'express';

import type { ColonyConfig } from '../config.js';

const EVENTS_DIR = '/tmp/colony-events';

const ColonyEventType = {
  PrOpened: 'pr_opened',
  PrComment: 'pr_comment',
  PrClosed: 'pr_closed',
  PrMerged: 'pr_merged',
} as const;
type ColonyEventType = (typeof ColonyEventType)[keyof typeof ColonyEventType];

export { ColonyEventType };

export interface ColonyEvent {
  type: ColonyEventType;
  prNumber: number;
  branch: string;
  payload: unknown;
  timestamp: string;
}

function verifySignature(secret: string, payload: string, signature: string): boolean {
  if (!signature) return false;

  const expected = `sha256=${createHmac('sha256', secret).update(payload).digest('hex')}`;

  if (expected.length !== signature.length) return false;

  return timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

function resolveEventType(
  action: string,
  eventName: string,
  merged: boolean,
): ColonyEventType | null {
  if (eventName === 'pull_request') {
    if (action === 'opened') return ColonyEventType.PrOpened;
    if (action === 'closed' && merged) return ColonyEventType.PrMerged;
    if (action === 'closed') return ColonyEventType.PrClosed;
  }

  if (eventName === 'pull_request_review_comment' || eventName === 'issue_comment') {
    return ColonyEventType.PrComment;
  }

  return null;
}

async function writeEventFile(event: ColonyEvent): Promise<string> {
  await mkdir(EVENTS_DIR, { recursive: true });
  const filePath = path.join(EVENTS_DIR, `${event.prNumber}.json`);
  await writeFile(filePath, JSON.stringify(event, null, 2), 'utf-8');
  return filePath;
}

export function createWebhookServer(config: ColonyConfig): express.Express {
  const app = express();

  let rawBody = '';
  app.use(express.json({
    limit: '10mb',
    verify: (_req, _res, buf) => {
      rawBody = buf.toString('utf-8');
    },
  }));

  app.post('/webhook', async (req: Request, res: Response) => {
    const signature = req.headers['x-hub-signature-256'] as string | undefined;
    const eventName = req.headers['x-github-event'] as string | undefined;

    if (config.webhookSecret && signature) {
      const isValid = verifySignature(config.webhookSecret, rawBody, signature);
      if (!isValid) {
        res.status(401).json({ error: 'Invalid signature' });
        return;
      }
    }

    if (!eventName) {
      res.status(400).json({ error: 'Missing X-GitHub-Event header' });
      return;
    }

    const payload = req.body as Record<string, unknown>;
    const action = payload.action as string;
    const pr = payload.pull_request as Record<string, unknown> | undefined;
    const issue = payload.issue as Record<string, unknown> | undefined;

    const prNumber = (pr?.number ?? issue?.number) as number | undefined;
    const branch = (pr?.head as Record<string, unknown> | undefined)?.ref as string | undefined;
    const merged = (pr?.merged as boolean) ?? false;

    if (!prNumber) {
      res.status(200).json({ message: 'No PR number, skipping' });
      return;
    }

    const eventType = resolveEventType(action, eventName, merged);
    if (!eventType) {
      res.status(200).json({ message: 'Unhandled event type, skipping' });
      return;
    }

    const event: ColonyEvent = {
      type: eventType,
      prNumber,
      branch: branch ?? '',
      payload,
      timestamp: new Date().toISOString(),
    };

    const filePath = await writeEventFile(event);
    res.status(200).json({ message: 'Event recorded', file: filePath });
  });

  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok' });
  });

  return app;
}

export function startWebhookServer(config: ColonyConfig): Promise<void> {
  return new Promise((resolve) => {
    const app = createWebhookServer(config);
    app.listen(config.ports.webhook, () => {
      console.log(`Webhook server listening on port ${config.ports.webhook}`);
      resolve();
    });
  });
}
