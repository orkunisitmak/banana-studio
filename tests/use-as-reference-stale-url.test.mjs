import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';

const source = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const start = source.indexOf('  const handleUseAsReference = async');
const end = source.indexOf('  // --- Template Handlers ---', start);
assert.ok(start >= 0 && end > start);
const compiled = transformSync(`module.exports = env => {
  const { flushSync, setConfig, toast, getReferenceImageLimit, FileReader, console, workspaceStorage } = env;
  ${source.slice(start, end)}
  return handleUseAsReference;
};`, { loader: 'ts', format: 'cjs' }).code;

const base = 'https://project.example/storage/v1/object/sign/media/user/a.png';
const stale = `${base}?token=expired`, fresh = `${base}?token=renewed`;

const createHandler = (t, { failRefresh = false } = {}) => {
  const fetched = [], toasts = [], added = [];
  t.mock.method(globalThis, 'fetch', async url => {
    fetched.push(String(url));
    return String(url) === fresh
      ? new Response(new Blob(['png'], { type: 'image/png' }))
      : new Response('expired', { status: 400 });
  });
  class FileReader {
    readAsDataURL() { this.result = 'data:image/png;base64,eA=='; this.onloadend(); }
  }
  const module = { exports: {} };
  new Function('module', compiled)(module);
  const handler = module.exports({
    flushSync: fn => fn(),
    setConfig: update => added.push(...(update({ referenceImages: [], mode: 'image' }).referenceImages || [])),
    toast: {
      success: (...a) => toasts.push(['success', ...a]),
      warning: (...a) => toasts.push(['warning', ...a]),
      error: (...a) => toasts.push(['error', ...a]),
    },
    getReferenceImageLimit: () => 14,
    FileReader,
    console: { error() {} },
    workspaceStorage: {
      refreshMediaAccessUrl: async url => {
        if (failRefresh) throw new Error('Signed URL renewal temporarily failed');
        return url.replace('token=expired', 'token=renewed');
      },
    },
  });
  return { handler, fetched, toasts, added };
};

test('Use as reference renews an expired signed link before downloading it', async t => {
  const { handler, fetched, toasts, added } = createHandler(t);
  await handler({ id: 'a', mediaType: 'image', url: stale });
  assert.deepEqual(fetched, [fresh]);
  assert.equal(added.length, 1);
  assert.deepEqual(toasts, [['success', 'Reference Added', 'Image added as reference.']]);
});

test('Use as reference still reports a failed download when the link cannot be renewed', async t => {
  const { handler, fetched, toasts, added } = createHandler(t, { failRefresh: true });
  await handler({ id: 'a', mediaType: 'image', url: stale });
  assert.deepEqual(fetched, [stale]);
  assert.equal(added.length, 0);
  assert.deepEqual(toasts, [['error', 'Reference Failed', 'Could not add image as reference.']]);
});
