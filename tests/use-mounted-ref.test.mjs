import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

// A minimal hook runtime: refs and effects persist per slot; mount runs effects,
// unmount runs their cleanups, StrictMode does unmount then mount on one instance.
const f = { renderer: null };
globalThis.__mountedRefFixture = f;
const bundle = await build({ entryPoints: ['src/components/useMountedRef.ts'], absWorkingDir: fileURLToPath(new URL('..', import.meta.url)),
  bundle: true, write: false, format: 'esm', platform: 'node', plugins: [{ name: 'mounted-ref', setup(b) {
    b.onResolve({ filter: /^react$/ }, () => ({ path: 'react', namespace: 'fixture' }));
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: `const r=()=>globalThis.__mountedRefFixture.renderer;
      export const useRef=value=>r().useRef(value),useEffect=(fn,deps)=>r().useEffect(fn,deps);` }));
  } }],
});
const { useMountedRef } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);

function instance() {
  const slots = []; let cursor = 0; const effects = [];
  const runtime = {
    useRef(value) { const i = cursor++; return slots[i] ||= { current: value }; },
    useEffect(fn, deps) { const i = cursor++; if (!slots[i]) { slots[i] = { deps }; effects.push(i); slots[i].fn = fn; } },
  };
  let ref;
  return {
    render() { cursor = 0; f.renderer = runtime; ref = useMountedRef(); return ref; },
    mount() { for (const i of effects) slots[i].cleanup = slots[i].fn(); },
    unmount() { for (const i of effects) slots[i].cleanup?.(); },
    get ref() { return ref; },
  };
}

test('the mounted ref is false before mount, true while mounted and false after unmount', () => {
  const gallery = instance();
  const ref = gallery.render();
  assert.equal(ref.current, false);
  gallery.mount();
  assert.equal(ref.current, true);
  gallery.unmount();
  assert.equal(ref.current, false);
});

test('React.StrictMode double mount leaves the ref true, so a live gallery still saves', () => {
  const gallery = instance();
  const ref = gallery.render();
  gallery.mount();
  gallery.unmount();
  gallery.mount();
  assert.equal(ref.current, true);
});

test('a handler from an unmounted gallery sees false even after a new gallery mounts', () => {
  const old = instance(), fresh = instance();
  const oldRef = old.render(); old.mount();
  old.unmount();
  fresh.render(); fresh.mount();
  assert.equal(oldRef.current, false);
  assert.equal(fresh.ref.current, true);
});
