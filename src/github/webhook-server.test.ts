import { createHmac } from 'node:crypto';

import request from 'supertest';
import { describe, it, expect } from 'vitest';

import type { ColonyConfig } from '../config.js';
import { createWebhookServer } from './webhook-server.js';

function createTestConfig(): ColonyConfig {
  return {
    targetRepo: '/tmp/test-repo',
    taskManager: 'github',
    github: { repo: 'owner/repo' },
    obsidian: { vaultPath: '/tmp/vault', enabled: false },
    ports: { dashboard: 4000, webhook: 4001 },
    session: { reviewerEnabled: true, autoSpawn: true },
    githubToken: 'test-token',
    webhookSecret: 'test-secret',
  };
}

function signPayload(secret: string, payload: string): string {
  return `sha256=${createHmac('sha256', secret).update(payload).digest('hex')}`;
}

describe('webhook-server', () => {
  it('should return health check', async () => {
    const app = createWebhookServer(createTestConfig());

    const res = await request(app).get('/health');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  it('should reject invalid signature', async () => {
    const config = createTestConfig();
    const app = createWebhookServer(config);

    const payload = { action: 'opened', pull_request: { number: 1 } };
    const body = JSON.stringify(payload);
    const invalidSignature =
      'sha256=0000000000000000000000000000000000000000000000000000000000000000';

    const res = await request(app)
      .post('/webhook')
      .set('Content-Type', 'application/json')
      .set('X-GitHub-Event', 'pull_request')
      .set('X-Hub-Signature-256', invalidSignature)
      .send(body);

    expect(res.status).toBe(401);
  });

  it('should reject missing event header', async () => {
    const config = createTestConfig();
    config.webhookSecret = '';
    const app = createWebhookServer(config);

    const res = await request(app).post('/webhook').send({});

    expect(res.status).toBe(400);
  });

  it('should handle PR opened event with valid signature', async () => {
    const config = createTestConfig();
    const app = createWebhookServer(config);

    const payload = {
      action: 'opened',
      pull_request: {
        number: 42,
        head: { ref: 'feat/test' },
        merged: false,
      },
    };
    const body = JSON.stringify(payload);
    const signature = signPayload(config.webhookSecret, body);

    const res = await request(app)
      .post('/webhook')
      .set('Content-Type', 'application/json')
      .set('X-GitHub-Event', 'pull_request')
      .set('X-Hub-Signature-256', signature)
      .send(body);

    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Event recorded');
  });
});
