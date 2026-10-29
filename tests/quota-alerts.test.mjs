import test from 'node:test';
import assert from 'node:assert/strict';
import { sendQuotaAlert } from '../api/_lib/generationQuota.ts';

test('quota alerts are disabled without a valid HTTPS webhook', async () => {
  delete process.env.BANANA_QUOTA_ALERT_WEBHOOK;
  assert.equal(await sendQuotaAlert({ scope: 'global', userId: 'u', limit: 5 }), false);
  process.env.BANANA_QUOTA_ALERT_WEBHOOK = 'http://insecure.example';
  assert.equal(await sendQuotaAlert({ scope: 'global', userId: 'u', limit: 5 }), false);
  delete process.env.BANANA_QUOTA_ALERT_WEBHOOK;
});

test('quota alerts post a bounded JSON event', async () => {
  process.env.BANANA_QUOTA_ALERT_WEBHOOK = 'https://hooks.example/quota';
  const originalFetch = globalThis.fetch;
  let request;
  globalThis.fetch = async (url, init) => {
    request = { url, init, body: JSON.parse(init.body) };
    return { ok: true, status: 200 };
  };
  try {
    assert.equal(await sendQuotaAlert({ scope: 'provider', userId: 'user-1', provider: 'fal', limit: 2 }), true);
    assert.equal(request.url, 'https://hooks.example/quota');
    assert.equal(request.init.method, 'POST');
    assert.equal(request.body.type, 'generation_quota_rejected');
    assert.equal(request.body.scope, 'provider');
    assert.equal(request.body.provider, 'fal');
    assert.equal(request.body.limit, 2);
    assert.equal(request.body.user_id, 'user-1');
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.BANANA_QUOTA_ALERT_WEBHOOK;
  }
});

test('a failing webhook never throws', async () => {
  process.env.BANANA_QUOTA_ALERT_WEBHOOK = 'https://hooks.example/quota';
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('network down'); };
  try {
    assert.equal(await sendQuotaAlert({ scope: 'global', userId: 'u', limit: 1 }), false);
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.BANANA_QUOTA_ALERT_WEBHOOK;
  }
});
