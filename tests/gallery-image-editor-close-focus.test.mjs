import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

// Mounts the real GalleryImageEditor with a minimal hook renderer (as in youtube-channel-ref.test.mjs)
// and checks that closing the editor focuses the Edit this image button that replaces it.
const react = `const R=()=>globalThis.__renderer;export const useState=v=>R().useState(v),useRef=v=>R().useRef(v),useEffect=(f,d)=>R().useEffect(f,d),useMemo=(f,d)=>R().useMemo(f,d);
  const h=(type,props,...children)=>({type,props:{...props,children}});export default {createElement:h,Fragment:'Fragment'};`;
const stubs = {
  react,
  'jsx-runtime': 'export const jsx=(type,props)=>({type,props}),jsxs=jsx,Fragment="Fragment";',
  'lucide-react': 'const i="i";export const AlertTriangle=i,ArrowRight=i,Check=i,Image=i,ImagePlus=i,Loader2=i,Pencil=i,RotateCcw=i,Sparkles=i,Wand2=i,X=i;',
  ProviderRoutingSettings: 'export const ProviderRouteControl=()=>null,useProviderRoute=()=>({error:null,provider:"openai"});',
  GalleryEditResults: 'export const GalleryEditResults=()=>null;',
  ImageEditCanvas: 'export const ImageEditCanvas=()=>null;',
  ImageEditComparison: 'export const ImageEditComparison=()=>null;',
  ControlDropdown: 'export const Dropdown=()=>null;',
  PromptComposerUI: 'const s="";export const ImageCountControl=()=>null,PROMPT_PANEL_CLASS=s,PROMPT_INPUT_CLASS=s,PROMPT_TEXTAREA_CLASS=s,PROMPT_TOOLBAR_CLASS=s,PROMPT_SETTINGS_CLASS=s,PROMPT_ACTIONS_CLASS=s,PROMPT_REVERT_CLASS=s,promptResizeClass=()=>s,promptEnhanceClass=()=>s,promptGenerateClass=()=>s;',
  geminiService: 'export const enhancePrompt=async()=>{throw new Error("unused")};',
};
const names = Object.keys(stubs).filter(name => !['react', 'jsx-runtime'].includes(name));
const compiled = await build({ entryPoints: ['src/components/GalleryImageEditor.tsx'], absWorkingDir: fileURLToPath(new URL('..', import.meta.url)), bundle: true, write: false, format: 'esm', platform: 'node', jsx: 'automatic', logLevel: 'silent',
  loader: { '.css': 'empty', '.svg': 'dataurl', '.png': 'dataurl' },
  plugins: [{ name: 'fixture', setup(b) {
    const filter = new RegExp(`^(react|react/jsx-runtime|lucide-react)$|[\\\\/](${names.filter(n => n !== 'lucide-react').join('|')})$`);
    b.onResolve({ filter }, args => ({ path: args.path === 'react/jsx-runtime' ? 'jsx-runtime' : args.path.split(/[\\/]/).at(-1), namespace: 'fixture' }));
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ loader: 'js', contents: stubs[args.path] }));
  } }] });
const { GalleryImageEditor } = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64'));

const mount = props => {
  const slots = []; let cursor = 0, tree, effects;
  const same = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  globalThis.__renderer = {
    useState(init) { const i = cursor++; if (!(i in slots)) slots[i] = { v: init }; return [slots[i].v, () => {}]; },
    useRef(init) { const i = cursor++; if (!(i in slots)) slots[i] = { current: init }; return slots[i]; },
    useMemo(make, deps) { const i = cursor++; if (!(i in slots) || !same(slots[i].deps, deps)) slots[i] = { v: make(), deps }; return slots[i].v; },
    useEffect(run, deps) { const i = cursor++; const prev = slots[i]; if (!prev || !deps || !same(prev.deps, deps)) effects.push(() => { prev?.cleanup?.(); slots[i] = { deps, cleanup: run() }; }); },
  };
  const focused = [];
  const walk = node => { if (!node || typeof node !== 'object') return; if (Array.isArray(node)) return node.forEach(walk);
    if (node.props?.ref) node.props.ref.current = { focus: () => focused.push(node.props['aria-label']) }; walk(node.props?.children); };
  const render = () => { cursor = 0; effects = []; tree = GalleryImageEditor(props); walk(tree); effects.forEach(run => run()); };
  render();
  return { focused, update: values => { Object.assign(props, values); render(); } };
};

test('closing the image editor focuses the Edit this image button', () => {
  globalThis.window = { innerWidth: 1200 };
  const image = { id: 'a', url: 'https://example.com/a.png', prompt: 'cat', mediaType: 'image' };
  const ui = mount({ image, images: [image], isEditing: false, onStart() {}, onGenerate: async () => [], onClose() {} });
  assert.deepEqual(ui.focused, [], 'mounting closed must not steal focus');
  ui.update({ isEditing: true });
  assert.deepEqual(ui.focused, [], 'opening without a selected area focuses nothing');
  ui.update({ isEditing: false });
  assert.deepEqual(ui.focused, ['Edit this image']);
});
