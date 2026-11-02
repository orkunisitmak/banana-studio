import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

// Call the real compare keyboard handler with the events a Turkish Q keyboard produces:
// the I key types dotless "ı" (code KeyI), and "[" / "]" need AltGr/Option.
const root = fileURLToPath(new URL('..', import.meta.url));
const req = createRequire(root + 'package.json');
const { build } = req('esbuild');
const compiled = await build({
  entryPoints: [root + 'src/components/ImageCompareDialog.tsx'], bundle: true, write: false, format: 'cjs', platform: 'node', logLevel: 'silent',
  external: ['react', 'react-dom', 'react-dom/server', 'react/jsx-runtime', 'react/jsx-dev-runtime'],
  loader: { '.css': 'empty' },
  plugins: [{ name: 'probe', setup(b) {
    b.onLoad({ filter: /components[\\/]ImageCompareDialog\.tsx$/ }, a => {
      const src = fs.readFileSync(a.path, 'utf8')
        .replace("useState<CompareView>('gallery')", "useState<CompareView>('slider')")
        .replace('const keyboardHandler = useRef<(event: KeyboardEvent) => void>(() => {});', 'const keyboardHandler = globalThis.__kb = { current: () => {} };')
        .replace("const [infoId, setInfoId] = useState<string | null>(null);", "const [infoId, setInfoIdReal] = useState<string | null>(null); const setInfoId = (v) => { (globalThis.__info ||= []).push(v); };")
        .replace('const [split, setSplit] = useState(50);', 'const [split, setSplitReal] = useState(50); const setSplit = (f) => { (globalThis.__split ||= []).push(f(50)); };');
      assert.ok(src.includes('globalThis.__kb') && src.includes('__info') && src.includes('__split') && src.includes("'slider')"));
      return { contents: src, loader: 'tsx' };
    });
  } }],
});
globalThis.window = globalThis; globalThis.document = { body: {}, activeElement: null, addEventListener() {}, removeEventListener() {} };
const mod = { exports: {} };
new Function('module', 'exports', 'require', compiled.outputFiles[0].text)(mod, mod.exports, req);
const React = req('react');
const ReactDOM = req('react-dom'); ReactDOM.createPortal = n => n;
const { renderToStaticMarkup } = req('react-dom/server');
const images = ['a', 'b'].map(id => ({ id, mediaType: 'image', url: `https://x/${id}.png`, prompt: id, status: 'completed' }));
renderToStaticMarkup(React.createElement(mod.exports.ImageCompareDialog, { images, onClose() {}, loadDetails: async () => null, refreshSource: async u => u }));
const press = (init) => { globalThis.__info = []; globalThis.__split = [];
  globalThis.__kb.current({ target: null, isComposing: false, repeat: false, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, code: '', preventDefault() {}, stopPropagation() {}, ...init });
  return { info: globalThis.__info, split: globalThis.__split }; };

test('Latin layout: Latin layout I opens image information and ] moves the slider', () => {
  assert.equal(press({ key: 'i', code: 'KeyI' }).info.length, 1);
  assert.deepEqual(press({ key: ']', code: 'BracketRight' }).split, [55]);
});
test('Turkish layout: the I key (types dotless ı) opens image information', () => {
  assert.equal(press({ key: 'ı', code: 'KeyI' }).info.length, 1);
});
test('Turkish layout: "]" typed with AltGr / Option moves the slider divider', () => {
  assert.deepEqual(press({ key: ']', code: 'Digit9', altKey: true }).split, [55]);
  assert.deepEqual(press({ key: ']', code: 'Digit9', altKey: true, ctrlKey: true }).split, [55]);
});
test('Ctrl or Cmd with a bracket is still left to the browser', () => {
  assert.deepEqual(press({ key: ']', code: 'BracketRight', ctrlKey: true }).split, []);
  assert.deepEqual(press({ key: ']', code: 'BracketRight', metaKey: true }).split, []);
});
