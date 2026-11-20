import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const start = app.indexOf('  const handleUseAsReference = async');
const compiled = await build({ stdin: { contents: `
  import * as referenceHelpers from './src/lib/images/imageReferences';
  import { SUNBURST_MODEL } from './src/lib/images/openaiImage';
  import { H3_MAX_CAPABILITIES } from './src/lib/video/h3Max';
  import { getH3MaxMode } from './src/lib/video/h3MaxConfig';
  export const add = async config => {
    const { getReferenceImageLimit } = referenceHelpers;
    const warnings = [], errors = [];
    const setConfig = update => { config = update(config); };
    const flushSync = run => run();
    const toast = { success() {}, warning: (...args) => warnings.push(args), error: (...args) => errors.push(args) };
    const workspaceStorage = { refreshMediaAccessUrl: async url => url };
    const fetch = async () => new Response('synthetic PNG bytes', { headers: { 'content-type': 'image/png' } });
    class FileReader { readAsDataURL() { this.result = 'data:image/png;base64,new-photo'; this.onloadend(); } }
    ${app.slice(start, app.indexOf('  // --- Template Handlers ---', start))}
    await handleUseAsReference({ id: 'gallery-result', mediaType: 'image', url: 'https://example.invalid/result.png' });
    return { config, warnings, errors };
  };
`, resolveDir: fileURLToPath(new URL('..', import.meta.url)), loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'node' });
const { add } = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64'));
const config = count => ({ mode: 'video', videoModel: 'seedance-2.5', videoOperation: 'generate', imageModel: 'gpt-image-2.5-sunburst',
  prompt: 'My video scene', referenceImages: Array.from({ length: count }, (_, i) => ({ id: `photo-${i}`, data: `data:image/png;base64,${i}`, mimeType: 'image/png' })) });

test('gallery Use as reference can fill the thirtieth supported Seedance image slot', async () => {
  const result = await add(config(29));
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.warnings, []);
  assert.equal(result.config.referenceImages.length, 30);
  assert.equal(result.config.prompt, 'My video scene');
});
test('gallery additions preserve the two-image frame-only limit', async () => {
  const current = config(2); current.referenceImages[0].isFirstFrame = true;
  const result = await add(current);
  assert.equal(result.config, current);
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0][1], /2 reference images/);
});
