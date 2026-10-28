import test from 'node:test';
import assert from 'node:assert/strict';
import { applyCors } from '../api/_lib/cors.ts';

const createResponse = () => {
  const headers = new Map();
  return {
    headers,
    statusCode: 200,
    ended: false,
    setHeader(name, value) {
      headers.set(name.toLowerCase(), value);
      return this;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    end() {
      this.ended = true;
      return this;
    },
  };
};

const withOrigins = async (value, run) => {
  if (value === undefined) delete process.env.BANANA_CORS_ORIGIN;
  else process.env.BANANA_CORS_ORIGIN = value;
  try {
    await run();
  } finally {
    delete process.env.BANANA_CORS_ORIGIN;
  }
};

test('same-origin requests need no wildcard CORS header', async () => {
  await withOrigins(undefined, async () => {
    const response = createResponse();
    assert.equal(applyCors({ method: 'POST', headers: {} }, response), true);
    assert.equal(response.headers.has('access-control-allow-origin'), false);
    assert.equal(response.headers.get('vary'), 'Origin');
  });
});

test('an allowlisted cross-origin caller receives only its own origin', async () => {
  await withOrigins('https://studio.example, https://admin.example', async () => {
    const response = createResponse();
    assert.equal(
      applyCors({ method: 'POST', headers: { origin: 'https://admin.example' } }, response),
      true,
    );
    assert.equal(
      response.headers.get('access-control-allow-origin'),
      'https://admin.example',
    );
    assert.equal(response.headers.get('vary'), 'Origin');
  });
});

test('unknown cross-origin callers never receive an allow-origin header', async () => {
  await withOrigins('https://studio.example', async () => {
    const response = createResponse();
    applyCors({ method: 'POST', headers: { origin: 'https://evil.example' } }, response);
    assert.equal(response.headers.has('access-control-allow-origin'), false);
  });
});

test('preflight is answered without reaching the handler', async () => {
  const response = createResponse();
  assert.equal(applyCors({ method: 'OPTIONS', headers: {} }, response), false);
  assert.equal(response.statusCode, 204);
  assert.equal(response.ended, true);
});
