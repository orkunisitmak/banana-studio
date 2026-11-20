import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const stubs = {
  authService: `export const SUPABASE_URL='https://x.supabase.co';export const getCurrentUserId=async()=>'u1';
    const from=()=>{const q={select(){return q},eq(){return q},maybeSingle(){return q},then(ok,fail){return Promise.resolve({data:globalThis.__row,error:null}).then(ok,fail)}};return q;};
    export const supabase={from,auth:{getSession:async()=>({data:{session:{user:{id:'u1'}}}})},storage:{from:()=>({createSignedUrls:async paths=>({data:paths.map(path=>({path,signedUrl:'https://x.supabase.co/sign/'+path,error:null})),error:null})})}};`,
  runtimeConfig: 'export const isLocalWorkspace=()=>false;',
  'tus-js-client': 'export class Upload{}',
};
const compiled = await build({ entryPoints: ['src/services/storageService.ts'], absWorkingDir: fileURLToPath(new URL('..', import.meta.url)), bundle: true, write: false, format: 'esm', platform: 'node',
  plugins: [{ name: 'stubs', setup(b) {
    b.onResolve({ filter: /^(\.\/authService|.*\/runtimeConfig|tus-js-client)$/ }, args => ({ path: Object.keys(stubs).find(key => args.path.endsWith(key)), namespace: 'stub' }));
    b.onLoad({ filter: /.*/, namespace: 'stub' }, args => ({ contents: stubs[args.path], loader: 'js' }));
    b.onResolve({ filter: /^[^./]/ }, args => ({ path: import.meta.resolve(args.path), external: true }));
  } }] });
const { getImageById } = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64'));

const load = async row => {
  globalThis.__row = { id: 'r1', user_id: 'u1', prompt: 'p', url: 'https://x.supabase.co/storage/v1/object/public/media/u1/r1', aspect_ratio: '9:16', created_at: 1, status: 'completed', ...row };
  return getImageById('r1', 'u1');
};

test('an older video row without stored quality shows its own resolution', async () => {
  assert.equal((await load({ type: 'video', resolution: '1080p', metadata: {} })).videoQuality, '1080p');
  assert.equal((await load({ type: 'video', resolution: '480p' })).videoQuality, '480p');
});

test('a video row keeps its explicit quality over the resolution column', async () => {
  assert.equal((await load({ type: 'video', resolution: '720p', metadata: { videoQuality: '1080p' } })).videoQuality, '1080p');
});

test('a video row with neither quality nor resolution falls back to 720p', async () => {
  assert.equal((await load({ type: 'video', metadata: {} })).videoQuality, '720p');
});

test('an image row never gets a video quality', async () => {
  assert.equal((await load({ type: 'image', resolution: '2K', metadata: {} })).videoQuality, undefined);
});
