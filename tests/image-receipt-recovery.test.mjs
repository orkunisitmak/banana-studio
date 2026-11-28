import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';

const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const monitor = app.slice(app.indexOf('  const resumePendingImage ='), app.indexOf('  const persistCompletedVideo ='));
const { code } = transformSync(`${monitor}; return resumePendingImage;`, { loader: 'ts', format: 'cjs' });
class Terminal extends Error {}
const archived = { id: 'job', url: 'durable', status: 'completed', seedreamResult: { images: [{url:'layer-1'}, {url:'layer-2'}] } };
async function resume(fields, error) {
  const calls = [];
  let cards = [{ id:'job', status:'processing', referenceImages:[], ...fields }];
  const env = {
    setGeneratedMedia: fn => { cards = fn(cards); }, setActiveRequests: () => {},
    isOpenAIImageModel: model => model === 'sunburst', isSeedreamEndpoint: endpoint => endpoint === 'seedream/layers',
    FalImageTaskFailedError: Terminal, assertWorkspaceSession: async () => {},
    resumeOpenAIImage: async () => { calls.push('worker'); return archived; },
    pollImageTask: async id => { calls.push(['poll', id]); if (error) throw error; },
    getImageById: async (_id, _user, options) => { calls.push(['read', options]); return archived; },
    resumeGptImage2Task: async id => { calls.push(['raw', id]); return 'image'; },
    prepareProtectedImageSource: async () => ({}), finishProtectedImageEdit: async media => media,
    saveImage: async () => { calls.push('save'); return null; }, mergeSavedMedia: media => media,
    updateImageStatus: async (_id, status) => calls.push(status), toast: { warning: () => calls.push('warn'), success: () => {} },
  };
  await new Function(...Object.keys(env), code)(...Object.values(env))(cards[0]);
  return { calls, card:cards[0] };
}

test('durable queue takes precedence over raw handles, but raw Sunburst is not mistaken for native OpenAI', async () => {
  const receipt = { imageModel:'sunburst', falRequestId:'accepted', falEndpoint:'fal/sunburst' };
  assert.deepEqual((await resume({ ...receipt, imageQueue:{ version:1 } })).calls, ['worker']);
  assert.deepEqual((await resume({ ...receipt, referenceImages:[{id:'r'}] })).calls, [['raw','accepted'], 'save', 'completed']);
});

test('raw Seedream resumes the server-archived gallery set; only a terminal outcome fails it', async () => {
  const receipt = { imageModel:'seedream-5.5', falRequestId:'accepted', falEndpoint:'seedream/layers' };
  const { calls, card } = await resume(receipt);
  assert.deepEqual(calls, [['poll','accepted'], ['read',{ requireRemote:true }]]);
  assert.deepEqual(card.seedreamResult, archived.seedreamResult);
  assert.deepEqual((await resume(receipt, new Error('database unavailable'))).calls, [['poll','accepted'], 'warn']);
  assert.deepEqual((await resume(receipt, new Terminal('refused'))).calls, [['poll','accepted'], 'failed']);
});
