import { createHmac, timingSafeEqual } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import express, { type Request, type Response } from 'express';

import type { HiveConfig } from '../config.js';
import { logger } from '../core/logger.js';

const EVENTS_DIR = '/tmp/hive-events';

const HiveEventType = {
  PrOpened: 'pr_opened',
  PrComment: 'pr_comment',
  PrClosed: 'pr_closed',
  PrMerged: 'pr_merged',
} as const;
type HiveEventType = (typeof HiveEventType)[keyof typeof HiveEventType];

export { HiveEventType };

export interface HiveEvent {
  type: HiveEventType;
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
): HiveEventType | null {
  if (eventName === 'pull_request') {
    if (action === 'opened') return HiveEventType.PrOpened;
    if (action === 'closed' && merged) return HiveEventType.PrMerged;
    if (action === 'closed') return HiveEventType.PrClosed;
  }

  if (eventName === 'pull_request_review_comment' || eventName === 'issue_comment') {
    return HiveEventType.PrComment;
  }

  return null;
}

async function writeEventFile(event: HiveEvent): Promise<string> {
  await mkdir(EVENTS_DIR, { recursive: true });
  const filePath = path.join(EVENTS_DIR, `${event.prNumber}.json`);
  await writeFile(filePath, JSON.stringify(event, null, 2), 'utf-8');
  return filePath;
}

async function handleWebhookEvent(
  config: HiveConfig,
  req: Request,
  res: Response,
  rawBody: string,
): Promise<void> {
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

  const event = buildHiveEvent(req, eventName);
  if (!event) {
    res.status(200).json({ message: 'Skipped: no PR number or unhandled event type' });
    return;
  }

  const filePath = await writeEventFile(event);
  res.status(200).json({ message: 'Event recorded', file: filePath });
}

function buildHiveEvent(req: Request, eventName: string): HiveEvent | null {
  const payload = req.body as Record<string, unknown>;
  const action = payload.action as string;
  const pr = payload.pull_request as Record<string, unknown> | undefined;
  const issue = payload.issue as Record<string, unknown> | undefined;

  const prNumber = (pr?.number ?? issue?.number) as number | undefined;
  if (!prNumber) return null;

  const branch = (pr?.head as Record<string, unknown> | undefined)?.ref as string | undefined;
  const merged = (pr?.merged as boolean) ?? false;

  const eventType = resolveEventType(action, eventName, merged);
  if (!eventType) return null;

  return {
    type: eventType,
    prNumber,
    branch: branch ?? '',
    payload,
    timestamp: new Date().toISOString(),
  };
}

export function createWebhookServer(config: HiveConfig): express.Express {
  const app = express();

  let rawBody = '';
  app.use(
    express.json({
      limit: '10mb',
      verify: (_req, _res, buf) => {
        rawBody = buf.toString('utf-8');
      },
    }),
  );

  app.post('/webhook', async (req: Request, res: Response) => {
    await handleWebhookEvent(config, req, res, rawBody);
  });

  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok' });
  });

  return app;
}

export function startWebhookServer(config: HiveConfig): Promise<void> {
  return new Promise((resolve) => {
    const app = createWebhookServer(config);
    app.listen(config.ports.webhook, () => {
      logger.info(`Webhook server listening on port ${config.ports.webhook}`);
      resolve();
    });
  });
}
