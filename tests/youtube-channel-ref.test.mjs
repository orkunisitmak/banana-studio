import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

// A minimal hook renderer, as in gallery-image-zoom.test.mjs: state slots, effects after render, re-render on change.
const react = `const R=()=>globalThis.__renderer;export const useState=v=>R().useState(v),useRef=v=>R().useRef(v),useEffect=(f,d)=>R().useEffect(f,d),useCallback=(f,d)=>R().useMemo(()=>f,d),useMemo=(f,d)=>R().useMemo(f,d);
  const h=(type,props,...children)=>({type,props:{...props,children}});export default {createElement:h,Fragment:'Fragment'};`;
const youtube = `export const isYouTubeConfigured=async()=>globalThis.__configured?globalThis.__configured():true;export const detectInputType=raw=>({kind:'channel',raw});
  export const resolveChannel=async input=>({id:'UC'+input,title:'Channel '+input,thumbnailUrl:'',uploadsPlaylistId:'UU'+input});
  export const getVideoInfo=async()=>{throw new Error('unused')};
  const gate=list=>playlist=>new Promise((resolve,reject)=>globalThis.__requests[list].push({playlist,resolve,reject}));
  export const getTopPerformingVideos=gate('top'),getLatestVideos=gate('latest');
  export const downloadThumbnail=async(...args)=>globalThis.__download ? globalThis.__download(...args) : ({});export const formatViewCount=String,formatDuration=String;`;
const compiled = await build({entryPoints:['src/components/YouTubeChannelRef.tsx'],absWorkingDir:fileURLToPath(new URL('..',import.meta.url)),bundle:true,write:false,format:'esm',platform:'node',jsx:'automatic',logLevel:'silent',
  plugins:[{name:'fixture',setup(b){
    b.onResolve({filter:/^(react|react\/jsx-runtime|react-dom|lucide-react)$|\/(youtubeService|youtubeBriefService)$/},args=>({path:args.path.split('/').at(-1),namespace:'fixture'}));
    b.onLoad({filter:/.*/,namespace:'fixture'},args=>({loader:'js',contents:({react,'jsx-runtime':'export const jsx=(type,props)=>({type,props}),jsxs=jsx,Fragment="Fragment";',
      'react-dom':'export const createPortal=x=>x;','lucide-react':'export const Youtube="i",Loader2="i",X="i",Search="i",TrendingUp="i",Clock="i",Check="i",Eye="i",Download="i",AlertCircle="i",Sparkles="i";',
      youtubeService:youtube,youtubeBriefService:'export const analyzeYouTubeVideo=async()=>{throw new Error("unused")};'})[args.path]}));
  }}]});
const { YouTubeChannelRef } = await import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text).toString('base64'));

const mount = props => {
  const slots = []; let cursor = 0, tree, effects, pending = false, destroyed = false;
  const same = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  globalThis.__renderer = {
    useState(init) { const i = cursor++; if (!(i in slots)) slots[i] = { v: init }; return [slots[i].v, next => { slots[i].v = typeof next === 'function' ? next(slots[i].v) : next; schedule(); }]; },
    useRef(init) { const i = cursor++; if (!(i in slots)) slots[i] = { current: init }; return slots[i]; },
    useMemo(make, deps) { const i = cursor++; if (!(i in slots) || !same(slots[i].deps, deps)) slots[i] = { v: make(), deps }; return slots[i].v; },
    useEffect(run, deps) { const i = cursor++; const prev = slots[i]; if (!prev || !deps || !same(prev.deps, deps)) effects.push(() => { prev?.cleanup?.(); slots[i] = { deps, cleanup: run() }; }); },
  };
  const expand = node => Array.isArray(node) ? node.map(expand) : node && typeof node === 'object' ? typeof node.type === 'function' ? expand(node.type(node.props || {}))
    : { ...node, props: { ...node.props, children: expand(node.props?.children) } } : node;
  const render = () => { if (destroyed) return; cursor = 0; effects = []; tree = expand(YouTubeChannelRef(props)); effects.forEach(run => run()); };
  const schedule = () => { if (!pending) { pending = true; queueMicrotask(() => { pending = false; render(); }); } };
  // The element data can share objects, so walks keep a visited set.
  const nodes = (node = tree, out = [], seen = new Set()) => { if (!node || typeof node !== 'object' || seen.has(node)) return out; seen.add(node);
    if (Array.isArray(node)) node.forEach(n => nodes(n, out, seen)); else { if (node.type !== undefined) out.push(node); nodes(node.props?.children, out, seen); } return out; };
  const text = (node, seen = new Set()) => node == null || typeof node === 'boolean' ? '' : typeof node !== 'object' ? String(node) : seen.has(node) ? ''
    : (seen.add(node), Array.isArray(node) ? node.map(n => text(n, seen)).join('') : text(node.props?.children, seen));
  const settle = async () => { for (let i = 0; i < 20; i++) await new Promise(resolve => setTimeout(resolve, 0)); };
  const click = async label => { const button = nodes().find(n => n.type === 'button' && ((n.props['aria-label'] || text(n.props.children)).startsWith(label))); assert.ok(button, `Expected available button: ${label}`); button.props.onClick({ stopPropagation() {}, preventDefault() {} }); await settle(); };
  const type = async value => { nodes().find(n => n.type === 'input').props.onChange({ target: { value } }); await settle(); };
  render();
  return { settle, click, type, text: () => text(tree), update: values => { Object.assign(props, values); render(); }, unmount: () => { destroyed = true; slots.forEach(slot => slot?.cleanup?.()); } };
};
const videos = (channel, count) => Array.from({ length: count }, (_, i) => ({ id: `${channel}${i}`, title: `${channel} video ${i}`, publishedAt: '2026-01-01', thumbnailUrl: `${channel}${i}`, viewCount: 1, likeCount: 0, duration: 60 }));

const modes = { top: 'Top Performing', latest: 'Browse & Pick' };
test('a failed availability check started before opening is retried while the panel stays open', async t => {
  globalThis.document = { addEventListener() {}, removeEventListener() {} };
  globalThis.window = { addEventListener() {}, removeEventListener() {}, innerWidth: 1200, innerHeight: 800 };
  let resolveFirst;
  const firstCheck = new Promise(resolve => { resolveFirst = resolve; });
  let calls = 0;
  globalThis.__configured = () => ++calls === 1 ? firstCheck : Promise.resolve(true);
  t.after(() => { delete globalThis.__configured; });
  const ui = mount({ onAddReferences() {}, onPrepareBrainstorm() {}, draftKey: 'k', remainingSlots: 14 });
  await ui.settle();
  assert.equal(calls, 1);
  await ui.click('YT');
  assert.equal(calls, 1);

  resolveFirst(false);
  await ui.settle();

  assert.equal(calls, 2);
  assert.match(ui.text(), /YouTube Ref/);
  assert.doesNotMatch(ui.text(), /YouTube API key not configured/);
});

const setup = async (first = 'top', second = 'latest') => {
  globalThis.document = { addEventListener() {}, removeEventListener() {} };
  globalThis.window = { addEventListener() {}, removeEventListener() {}, innerWidth: 1200, innerHeight: 800 };
  globalThis.__requests = { top: [], latest: [] };
  const ui = mount({ onAddReferences() {}, onPrepareBrainstorm() {}, draftKey: 'k', remainingSlots: 14 });
  await ui.settle(); await ui.click('YT');
  // Channel A starts one list, then the user switches to channel B's other list.
  await ui.type('A'); await ui.click('Look up YouTube link'); await ui.click(modes[first]);
  await ui.click('Change'); await ui.type('B'); await ui.click('Look up YouTube link'); await ui.click(modes[second]);
  const [a] = globalThis.__requests[first], [b] = globalThis.__requests[second];
  assert.equal(a.playlist, 'UUA'); assert.equal(b.playlist, 'UUB');
  return { ui, a, b };
};

test('a late Top Performing response for the previous channel never replaces the current list', async () => {
  const { ui, a, b } = await setup();
  b.resolve(videos('B', 3)); await ui.settle();
  a.resolve(videos('A', 10)); await ui.settle();
  assert.match(ui.text(), /Channel B/);
  assert.match(ui.text(), /B video/);
  assert.doesNotMatch(ui.text(), /A video/);
  assert.match(ui.text(), /\b0\/10 selected/);
});

test('a late failure for the previous channel neither ends loading nor shows its error', async () => {
  const { ui, a, b } = await setup();
  a.reject(new Error('A failed')); await ui.settle();
  assert.match(ui.text(), /Loading videos/);
  assert.doesNotMatch(ui.text(), /A failed/);
  b.reject(new Error('B failed')); await ui.settle();
  assert.match(ui.text(), /B failed/);
  assert.doesNotMatch(ui.text(), /A failed/);
});

test('a late Browse success for the previous channel leaves the current Top Performing list alone', async () => {
  const { ui, a, b } = await setup('latest', 'top');
  b.resolve(videos('B', 3)); await ui.settle();
  const shown = ui.text();
  a.resolve(videos('A', 10)); await ui.settle();
  assert.equal(ui.text(), shown);
  assert.match(shown, /Channel B/);
  assert.match(shown, /B video/);
  assert.doesNotMatch(shown, /A video/);
});

test('a late Browse failure for the previous channel neither ends loading nor shows its error', async () => {
  const { ui, a, b } = await setup('latest', 'top');
  a.reject(new Error('A failed')); await ui.settle();
  assert.match(ui.text(), /Finding top performing videos/);
  assert.doesNotMatch(ui.text(), /A failed/);
  b.resolve(videos('B', 3)); await ui.settle();
  assert.match(ui.text(), /B video/);
  assert.doesNotMatch(ui.text(), /A failed/);
});

test('a Browse failure for the previous channel after the current list arrived shows no error', async () => {
  // An empty list is where a stray error would be rendered.
  const { ui, a, b } = await setup('latest', 'top');
  b.resolve(videos('B', 0)); await ui.settle();
  const shown = ui.text();
  a.reject(new Error('A failed')); await ui.settle();
  assert.equal(ui.text(), shown);
  assert.doesNotMatch(ui.text(), /A failed/);
});


const thumbnailScenario = async t => {
  globalThis.document = { addEventListener() {}, removeEventListener() {} };
  globalThis.window = { addEventListener() {}, removeEventListener() {}, innerWidth: 1200, innerHeight: 800 };
  globalThis.__requests = { top: [], latest: [] };
  const requests = [], added = [];
  globalThis.__download = (url, options) => new Promise((resolve, reject) => requests.push({ url, signal: options?.signal, resolve: () => resolve('data:image/jpeg;base64,' + url), reject }));
  t.after(() => { delete globalThis.__download; });
  const ui = mount({ onAddReferences: refs => added.push(...refs), onPrepareBrainstorm() {}, draftKey: 'first-draft', remainingSlots: 14 });
  const open = async (name, count = 1) => {
    await ui.click('YT'); await ui.type(name); await ui.click('Look up YouTube link'); await ui.click('Top Performing');
    globalThis.__requests.top.at(-1).resolve(videos(name, count)); await ui.settle();
  };
  await ui.settle(); await open('A', 2); await ui.click('Add 2 Thumbnail');
  assert.equal(requests.length, 1);
  return { ui, open, requests, added };
};

test('closing YouTube references aborts the download and never adds abandoned thumbnails', async t => {
  const { ui, requests, added } = await thumbnailScenario(t);
  await ui.click('Close YouTube reference');
  const aborted = requests[0].signal?.aborted;
  requests[0].resolve(); await ui.settle(); requests[1]?.resolve(); await ui.settle();
  assert.deepEqual(added, []);
  assert.equal(requests.length, 1, 'do not start the remaining downloads after closing');
  assert.equal(aborted, true);
});
test('a stale thumbnail completion cannot close or unlock a newly opened download', async t => {
  const { ui, open, requests, added } = await thumbnailScenario(t);
  await ui.click('Close YouTube reference'); await open('B');
  await ui.click('Add 1 Thumbnail');
  const current = requests.find(request => request.url === 'B0');
  assert.ok(current, 'the new panel must be usable immediately');
  requests[0].resolve(); await ui.settle(); requests.find(request => request.url === 'A1')?.resolve(); await ui.settle();
  assert.match(ui.text(), /Downloading thumbnails/);
  assert.deepEqual(added, []);
  current.resolve(); await ui.settle();
  assert.deepEqual(added.map(ref => ref.data), ['data:image/jpeg;base64,B0']);
});
test('unmounting YouTube references cannot add a late download to the composer', async t => {
  const { ui, requests, added } = await thumbnailScenario(t);
  ui.unmount(); const aborted = requests[0].signal?.aborted;
  requests[0].resolve(); await ui.settle(); requests[1]?.resolve(); await ui.settle();
  assert.deepEqual(added, []);
  assert.equal(aborted, true);
});
test('a changed creative draft invalidates pending YouTube thumbnail additions', async t => {
  const { ui, requests, added } = await thumbnailScenario(t);
  ui.update({ draftKey: 'second-draft' }); await ui.settle();
  requests[0].resolve(); await ui.settle(); requests[1]?.resolve(); await ui.settle();
  assert.deepEqual(added, []);
  assert.equal(requests[0].signal?.aborted, true);
  assert.doesNotMatch(ui.text(), /Downloading thumbnails/);
});
test('active thumbnail failures preserve successful references and allow retry', async t => {
  const { ui, requests, added } = await thumbnailScenario(t);
  requests[0].resolve(); await ui.settle(); requests[1].reject(new Error('Temporary thumbnail failure')); await ui.settle();
  assert.deepEqual(added.map(ref => ref.data), ['data:image/jpeg;base64,A0']);
  assert.match(ui.text(), /1 of 2 thumbnails could not be downloaded/);
  await ui.click('Add 1 Thumbnail'); requests[2].resolve(); await ui.settle();
  assert.deepEqual(added.map(ref => ref.data), ['data:image/jpeg;base64,A0', 'data:image/jpeg;base64,A1']);
});

test('an abandoned thumbnail rejection leaves the new request active and retryable', async t => {
  const { ui, open, requests, added } = await thumbnailScenario(t);
  await ui.click('Close YouTube reference'); await open('B'); await ui.click('Add 1 Thumbnail');
  requests[0].reject(new DOMException('Cancelled old request', 'AbortError')); await ui.settle();
  assert.match(ui.text(), /Downloading thumbnails/);
  assert.doesNotMatch(ui.text(), /Cancelled old request/);
  requests.find(request => request.url === 'B0').resolve(); await ui.settle();
  assert.deepEqual(added.map(ref => ref.data), ['data:image/jpeg;base64,B0']);
});
