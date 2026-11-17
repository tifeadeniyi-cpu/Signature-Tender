import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AppError } from '@st/core';

vi.mock('server-only', () => ({}));
vi.mock('next/server', () => ({ after: vi.fn() }));
vi.mock('./db', () => ({ db: vi.fn() }));

const current: { APP_ENV: string; WEBHOOK_SECRETS_KEY?: string; BETTER_AUTH_SECRET: string } = {
  APP_ENV: 'production',
  BETTER_AUTH_SECRET: 'x'.repeat(32),
};
vi.mock('./env', () => ({ env: () => current }));

const { webhooksReady, webhookContext, runWebhookDispatch, WEBHOOKS_NOT_READY } = await import(
  './webhooks'
);

describe('webhook readiness', () => {
  beforeEach(() => {
    current.APP_ENV = 'production';
    delete current.WEBHOOK_SECRETS_KEY;
  });

  it('is not ready in production without its own key, and says why in forms', () => {
    expect(webhooksReady()).toBe(false);
    expect(() => webhookContext()).toThrow(AppError);
    expect(() => webhookContext()).toThrow(WEBHOOKS_NOT_READY);
  });

  it('skips dispatch quietly instead of failing the cron run', async () => {
    await expect(runWebhookDispatch()).resolves.toBeNull();
  });

  it('is ready in production once the key is set, and outside production', () => {
    current.WEBHOOK_SECRETS_KEY = 'k'.repeat(32);
    expect(webhooksReady()).toBe(true);
    expect(webhookContext().encKey).toBeInstanceOf(Buffer);
    delete current.WEBHOOK_SECRETS_KEY;
    current.APP_ENV = 'staging';
    expect(webhooksReady()).toBe(true);
  });
});
