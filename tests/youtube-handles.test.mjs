import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

// The real service runs against a stubbed session and a fake YouTube proxy that records channel lookups.
const compiled = await build({entryPoints:['src/services/youtubeService.ts'],absWorkingDir:fileURLToPath(new URL('..',import.meta.url)),bundle:true,write:false,format:'esm',platform:'node',logLevel:'silent',
  plugins:[{name:'fixture',setup(b){
    b.onResolve({filter:/\/authService$/},()=>({path:'auth',namespace:'fixture'}));
    b.onLoad({filter:/.*/,namespace:'fixture'},()=>({loader:'js',contents:'export const supabase={auth:{getSession:async()=>({data:{session:null}})}};'}));
  }}]});
const youtube = await import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text).toString('base64'));

const lookups = [];
globalThis.fetch = async (_url, init) => {
  const { endpoint, params } = JSON.parse(init.body);
  lookups.push({ endpoint, ...params });
  const items = endpoint === 'channels' ? [{ id: 'UC1', snippet: { title: 'Channel', thumbnails: {} }, contentDetails: { relatedPlaylists: { uploads: 'UU1' } } }] : [];
  return { ok: true, status: 200, json: async () => ({ items }) };
};
const lookup = async input => { lookups.length = 0; await youtube.resolveChannel(input); return lookups.map(({ endpoint, forHandle, forUsername }) => ({ endpoint, forHandle, forUsername })); };

test('non-ASCII handles reach the API as the handle itself', async () => {
  assert.deepEqual(await lookup('https://www.youtube.com/@%C3%A7a%C4%9Fr%C4%B1'), [{ endpoint: 'channels', forHandle: '@çağrı', forUsername: undefined }]);
  assert.deepEqual(await lookup('https://www.youtube.com/@çağrı/videos'), [{ endpoint: 'channels', forHandle: '@çağrı', forUsername: undefined }]);
  assert.deepEqual(await lookup('@çağrı'), [{ endpoint: 'channels', forHandle: '@çağrı', forUsername: undefined }]);
  assert.deepEqual(await lookup('çağrı'), [{ endpoint: 'channels', forHandle: '@çağrı', forUsername: undefined }]);
  assert.deepEqual(await lookup('youtube.com/c/%C3%96rnek'), [{ endpoint: 'channels', forHandle: undefined, forUsername: 'Örnek' }]);
  assert.deepEqual(youtube.detectInputType('@çağrı'), { kind: 'channel', raw: '@çağrı' });
});

test('ASCII and malformed inputs keep their current handling', async () => {
  assert.deepEqual(await lookup('@banana.studio'), [{ endpoint: 'channels', forHandle: '@banana.studio', forUsername: undefined }]);
  assert.deepEqual(await lookup('bananastudio'), [{ endpoint: 'channels', forHandle: '@bananastudio', forUsername: undefined }]);
  assert.deepEqual(await lookup('https://youtube.com/@bad%E0%A4%A'), [{ endpoint: 'channels', forHandle: '@bad%E0%A4%A', forUsername: undefined }]);
  assert.equal(youtube.detectInputType('example.com/@çağrı'), null);
  await assert.rejects(youtube.resolveChannel('@çağ rı'), /Invalid channel/);
});

test('bare dotted handles use the same channel lookup as their @ forms', async () => {
  for (const handle of ['banana.studio', 'çağrı.studio', 'e\u0301.channel']) {
    assert.deepEqual(youtube.detectInputType(handle), { kind: 'channel', raw: handle });
    assert.deepEqual(await lookup(handle), await lookup(`@${handle}`));
    assert.deepEqual(await lookup(handle), [{ endpoint: 'channels', forHandle: `@${handle}`, forUsername: undefined }]);
  }
});

test('bare YouTube hostnames stay on the URL path without querying a handle', async () => {
  for (const host of ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'YouTube.COM', 'youtu.be', 'www.youtu.be']) {
    lookups.length = 0;
    assert.equal(youtube.detectInputType(host), null, host);
    await assert.rejects(youtube.resolveChannel(host), /Invalid channel/, host);
    assert.deepEqual(lookups, [], host);
  }
  assert.deepEqual(await lookup('@youtube.com'), [{ endpoint: 'channels', forHandle: '@youtube.com', forUsername: undefined }]);
});
