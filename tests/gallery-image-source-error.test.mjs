import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const req = createRequire(root + '/package.json');
const { build } = req('esbuild');

const out = await build({
  entryPoints: ['./src/components/useGalleryImageSource.ts'],
  absWorkingDir: root,
  bundle: true,
  write: false,
  format: 'cjs',
  platform: 'node',
  nodePaths: [root + '/node_modules'],
  logLevel: 'silent',
  external: ['react'],
  plugins: [{
    name: 'stub-storage',
    setup(b) {
      b.onResolve({ filter: /storageService$/ }, () => ({ path: 'storageService', namespace: 'stub' }));
      b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
        contents: 'export const refreshMediaAccessUrl = async url => url;',
        loader: 'js',
      }));
    },
  }],
});

const mod = { exports: {} };
new Function('module', 'exports', 'require', out.outputFiles[0].text)(mod, mod.exports, req);
const { useGalleryImageSource } = mod.exports;

const React = req('react');

function mountHook(src, fallbackSrc) {
  const realUseState = React.useState;
  const realUseRef = React.useRef;
  const realUseEffect = React.useEffect;

  const states = [];
  const refs = [];
  let effect = null;
  let cleanup = null;

  const render = () => {
    let si = 0;
    let ri = 0;
    effect = null;
    React.useState = init => {
      const idx = si++;
      if (!(idx in states)) states[idx] = typeof init === 'function' ? init() : init;
      const setState = next => {
        states[idx] = typeof next === 'function' ? next(states[idx]) : next;
      };
      return [states[idx], setState];
    };
    React.useRef = init => {
      const idx = ri++;
      if (!(idx in refs)) refs[idx] = { current: init };
      return refs[idx];
    };
    React.useEffect = fn => {
      effect = fn;
    };
    try {
      return useGalleryImageSource(src, fallbackSrc);
    } finally {
      React.useState = realUseState;
      React.useRef = realUseRef;
      React.useEffect = realUseEffect;
    }
  };

  let latest = render();
  if (effect) cleanup = effect() || null;
  latest = render();
  return {
    current: () => latest,
    rerender: () => { latest = render(); return latest; },
    unmount: () => { if (cleanup) cleanup(); },
  };
}

test('non-stored image with fallbackSrc === src fails immediately on onError instead of waiting for timeout', () => {
  const url = 'https://example.com/broken.png';
  const hook = mountHook(url, url);
  try {
    assert.equal(hook.current().loading, true);
    assert.equal(hook.current().failed, false);
    hook.current().onError();
    const after = hook.rerender();
    assert.equal(after.loading, false, 'loading should stop immediately when the only URL fails');
    assert.equal(after.failed, true, 'failed should be true immediately so Retry is shown');
    assert.equal(after.url, '', 'broken URL should be cleared');
    assert.equal(after.preview, false);
  } finally {
    hook.unmount();
  }
});

test('non-stored image with distinct fallbackSrc falls back to preview first, then clears on second error', () => {
  const hook = mountHook('https://example.com/full.png', 'https://example.com/thumb.png');
  try {
    hook.current().onError();
    const afterFirst = hook.rerender();
    assert.equal(afterFirst.loading, false);
    assert.equal(afterFirst.failed, true);
    assert.equal(afterFirst.preview, true);
    assert.equal(afterFirst.url, 'https://example.com/thumb.png');

    afterFirst.onError();
    const afterSecond = hook.rerender();
    assert.equal(afterSecond.loading, false);
    assert.equal(afterSecond.failed, true);
    assert.equal(afterSecond.preview, false);
    assert.equal(afterSecond.url, '');
  } finally {
    hook.unmount();
  }
});

test('stored image thumbnail error keeps loading while original fetch is still pending', () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = () => new Promise(() => {});
  const stored = 'https://proj.supabase.co/storage/v1/object/sign/media/full.png?token=abc';
  const thumb = 'https://proj.supabase.co/storage/v1/object/sign/media/thumb.png?token=abc';
  const hook = mountHook(stored, thumb);
  try {
    assert.equal(hook.current().url, thumb);
    assert.equal(hook.current().loading, true);
    hook.current().onError();
    const after = hook.rerender();
    assert.equal(after.url, '');
    assert.equal(after.loading, true, 'stored image fetch is still running');
    assert.equal(after.failed, false);
  } finally {
    hook.unmount();
    globalThis.fetch = realFetch;
  }
});
