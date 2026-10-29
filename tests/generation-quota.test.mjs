import test from 'node:test';
import assert from 'node:assert/strict';
import {
  dailyGenerationLimit,
  enforceDailyGenerationQuota,
  providerDailyLimit,
} from '../api/_lib/generationQuota.ts';

const createResponse = () => ({
  statusCode: 200,
  body: null,
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(body) {
    this.body = body;
    return this;
  },
});

const createRpcDb = (result) => ({
  rpc(name, args) {
    assert.equal(name, 'reserve_generation_quota');
    assert.equal(args.p_limit > 0, true);
    return Promise.resolve(result);
  },
});

const withLimit = async (limit, run) => {
  if (limit === undefined) delete process.env.BANANA_DAILY_GENERATION_LIMIT;
  else process.env.BANANA_DAILY_GENERATION_LIMIT = String(limit);
  try {
    await run();
  } finally {
    delete process.env.BANANA_DAILY_GENERATION_LIMIT;
  }
};

test('dailyGenerationLimit ignores missing, zero and invalid values', () => {
  delete process.env.BANANA_DAILY_GENERATION_LIMIT;
  assert.equal(dailyGenerationLimit(), 0);
  process.env.BANANA_DAILY_GENERATION_LIMIT = '0';
  assert.equal(dailyGenerationLimit(), 0);
  process.env.BANANA_DAILY_GENERATION_LIMIT = 'not-a-number';
  assert.equal(dailyGenerationLimit(), 0);
  process.env.BANANA_DAILY_GENERATION_LIMIT = '7.8';
  assert.equal(dailyGenerationLimit(), 7);
  delete process.env.BANANA_DAILY_GENERATION_LIMIT;
});

test('a disabled quota does not touch the database', async () => {
  await withLimit(undefined, async () => {
    assert.equal(await enforceDailyGenerationQuota(null, 'user-1', createResponse()), true);
  });
});

test('an atomic reservation admits the request', async () => {
  await withLimit(2, async () => {
    assert.equal(
      await enforceDailyGenerationQuota(createRpcDb({ data: true, error: null }), 'user-1', createResponse()),
      true,
    );
  });
});

test('an atomic reservation rejects the final slot with 429', async () => {
  await withLimit(1, async () => {
    const response = createResponse();
    assert.equal(
      await enforceDailyGenerationQuota(createRpcDb({ data: false, error: null }), 'user-1', response),
      false,
    );
    assert.equal(response.statusCode, 429);
    assert.equal(response.body.code, 'DAILY_GENERATION_LIMIT');
  });
});

test('a broken reservation RPC fails closed with 503', async () => {
  await withLimit(2, async () => {
    const response = createResponse();
    assert.equal(
      await enforceDailyGenerationQuota(createRpcDb({ data: null, error: { message: 'db down' } }), 'user-1', response),
      false,
    );
    assert.equal(response.statusCode, 503);
  });
});

test('a missing reservation RPC fails closed instead of using a racy count', async () => {
  await withLimit(2, async () => {
    const response = createResponse();
    assert.equal(
      await enforceDailyGenerationQuota({ from() { throw new Error('must not count'); } }, 'user-1', response),
      false,
    );
    assert.equal(response.statusCode, 503);
  });
});

test('providerDailyLimit parses and clamps the JSON map', () => {
  process.env.BANANA_DAILY_PROVIDER_LIMITS = '{"fal":3,"OpenAI":5,"bad provider":9,"gemini":0}';
  assert.equal(providerDailyLimit('fal'), 3);
  assert.equal(providerDailyLimit('openai'), 0);
  assert.equal(providerDailyLimit('gemini'), 0);
  assert.equal(providerDailyLimit('missing'), 0);
  delete process.env.BANANA_DAILY_PROVIDER_LIMITS;
});

test('a rejected provider reservation returns 429 and releases the global slot', async () => {
  process.env.BANANA_DAILY_GENERATION_LIMIT = '5';
  process.env.BANANA_DAILY_PROVIDER_LIMITS = '{"fal":1}';
  const calls = [];
  const db = {
    rpc(name, args) {
      calls.push(name);
      if (name === 'reserve_generation_quota') return Promise.resolve({ data: true, error: null });
      if (name === 'reserve_generation_provider_quota') {
        assert.equal(args.p_provider, 'fal');
        return Promise.resolve({ data: false, error: null });
      }
      if (name === 'release_generation_quota') return Promise.resolve({ data: null, error: null });
      throw new Error(`unexpected RPC ${name}`);
    },
  };
  const response = createResponse();
  try {
    assert.equal(await enforceDailyGenerationQuota(db, 'user-1', response, 'fal'), false);
    assert.equal(response.statusCode, 429);
    assert.equal(response.body.code, 'DAILY_PROVIDER_LIMIT');
    assert.deepEqual(calls, ['reserve_generation_quota', 'reserve_generation_provider_quota', 'release_generation_quota']);
  } finally {
    delete process.env.BANANA_DAILY_GENERATION_LIMIT;
    delete process.env.BANANA_DAILY_PROVIDER_LIMITS;
  }
});
