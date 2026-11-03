import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

// The real service runs against a stubbed session and a fake YouTube proxy.
const compiled = await build({entryPoints:['src/services/youtubeService.ts'],absWorkingDir:fileURLToPath(new URL('..',import.meta.url)),bundle:true,write:false,format:'esm',platform:'node',logLevel:'silent',
  plugins:[{name:'fixture',setup(b){
    b.onResolve({filter:/\/authService$/},()=>({path:'auth',namespace:'fixture'}));
    b.onLoad({filter:/.*/,namespace:'fixture'},()=>({loader:'js',contents:'export const supabase={auth:{getSession:async()=>({data:{session:null}})}};'}));
  }}]});
const youtube = await import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text).toString('base64'));

const durations = { aaaaaaaaaaa: 'PT4M5S', bbbbbbbbbbb: 'PT2H', ccccccccccc: 'P1DT2H3M4S', ddddddddddd: 'P1D', eeeeeeeeeee: 'P0D' };
const video = id => ({ id, snippet: { title: id, publishedAt: new Date().toISOString(), thumbnails: {} }, statistics: { viewCount: '1' }, contentDetails: { duration: durations[id] } });
globalThis.fetch = async (_url, init) => {
  const { endpoint, params } = JSON.parse(init.body);
  const data = endpoint === 'playlistItems' ? { items: Object.keys(durations).map(videoId => ({ contentDetails: { videoId } })) }
    : { items: params.id.split(',').map(video) };
  return { ok: true, status: 200, json: async () => data };
};

test('video durations of a day or longer keep their days', async () => {
  assert.equal((await youtube.getVideoInfo('ccccccccccc')).durationSeconds, 93784);
  assert.equal((await youtube.getVideoInfo('ddddddddddd')).durationSeconds, 86400);
  assert.equal((await youtube.getVideoInfo('aaaaaaaaaaa')).durationSeconds, 245);
  assert.equal((await youtube.getVideoInfo('bbbbbbbbbbb')).durationSeconds, 7200);
  // Live streams still report no known duration.
  assert.equal((await youtube.getVideoInfo('eeeeeeeeeee')).durationSeconds, 0);
});

test('day-long uploads stay in the long-form lists', async () => {
  assert.deepEqual((await youtube.getLatestVideos('UUchannel')).map(v => v.id), ['aaaaaaaaaaa', 'bbbbbbbbbbb', 'ccccccccccc', 'ddddddddddd']);
  assert.deepEqual((await youtube.getTopPerformingVideos('UUchannel')).map(v => v.id).sort(), ['aaaaaaaaaaa', 'bbbbbbbbbbb', 'ccccccccccc', 'ddddddddddd']);
});
