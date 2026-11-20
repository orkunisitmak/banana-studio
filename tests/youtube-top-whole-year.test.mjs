import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

// Runs the real getTopPerformingVideos against a stubbed /api/youtube proxy.
const root = fileURLToPath(new URL('..', import.meta.url));
const req = createRequire(root + '/package.json');
const { build } = req('esbuild');
const out = await build({
  entryPoints: ['./src/services/youtubeService.ts'], absWorkingDir: root, bundle: true, write: false, format: 'cjs', platform: 'node', logLevel: 'silent',
  plugins: [{ name: 'auth', setup(b) {
    b.onResolve({ filter: /[\\/]authService$/ }, () => ({ path: 'auth', namespace: 'stub' }));
    b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ loader: 'js', contents: 'export const supabase = { auth: { getSession: async () => ({ data: { session: { access_token: "t" } } }) } };' }));
  } }],
});
const mod = { exports: {} };
new Function('module', 'exports', 'require', out.outputFiles[0].text)(mod, mod.exports, req);
const { getTopPerformingVideos } = mod.exports;

// A channel that posts a Short every day and a long video every 3rd day: 480 uploads in the last 360 days, newest first.
const DAY = 86400_000, now = Date.now();
const uploads = Array.from({ length: 480 }, (_, i) => {
  const day = Math.floor(i * 360 / 480);
  const long = i % 4 === 3;
  return { id: `v${String(i).padStart(9, '0')}`, publishedAt: new Date(now - (day + 1) * DAY).toISOString(),
    duration: long ? 'PT12M30S' : 'PT45S', views: long ? 1000 + i : 50 };
});
// The channel's biggest long video of the year, 300 days ago (upload #400).
uploads[399] = { ...uploads[399], duration: 'PT20M', views: 9_000_000 };
const byId = new Map(uploads.map(v => [v.id, v]));
let requests = 0;
globalThis.fetch = async (_url, init) => {
  requests++;
  const { endpoint, params } = JSON.parse(init.body);
  if (endpoint === 'playlistItems') {
    const start = Number(params.pageToken || 0), size = Number(params.maxResults);
    const page = uploads.slice(start, start + size);
    return Response.json({ items: page.map(v => ({ contentDetails: { videoId: v.id } })), ...(start + size < uploads.length ? { nextPageToken: String(start + size) } : {}) });
  }
  if (endpoint === 'videos') return Response.json({ items: params.id.split(',').map(id => byId.get(id)).map(v => ({ id: v.id,
    snippet: { title: v.id, publishedAt: v.publishedAt, thumbnails: { high: { url: `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg` } } },
    contentDetails: { duration: v.duration }, statistics: { viewCount: String(v.views) } })) });
  throw new Error('unexpected endpoint ' + endpoint);
};

test('control: the list holds 10 long-form videos from the last year, most-viewed first', async () => {
  const top = await getTopPerformingVideos('UUchannel', 10);
  assert.equal(top.length, 10);
  assert.ok(top.every(v => v.durationSeconds > 240 && Date.parse(v.publishedAt) >= now - 366 * DAY));
  assert.ok(top.every((v, i) => !i || top[i - 1].viewCount >= v.viewCount));
});

test("'top 10 most-viewed from last year' includes the year's most-viewed long video (300 days old)", async () => {
  const top = await getTopPerformingVideos('UUchannel', 10);
  const oldest = top.reduce((min, v) => Math.min(min, Date.parse(v.publishedAt)), Infinity);
  assert.equal(top[0]?.id, uploads[399].id,
    `#1 is ${top[0]?.id} (${top[0]?.viewCount} views); the 9,000,000-view video from 300 days ago is missing. Oldest video considered: ${Math.round((now - oldest) / DAY)} days old`);
});

test('the scan stops once uploads are older than a year', async () => {
  const before = requests;
  const old = uploads.map((v, i) => i >= 100 ? { ...v, publishedAt: new Date(now - (400 + i) * DAY).toISOString() } : v);
  byId.clear(); old.forEach(v => byId.set(v.id, v));
  uploads.splice(0, uploads.length, ...old);
  const top = await getTopPerformingVideos('UUchannel', 10);
  assert.ok(requests - before <= 6, `${requests - before} requests for a channel with 100 uploads in the last year`);
  assert.ok(top.length > 0 && top.every(v => Date.parse(v.publishedAt) >= now - 366 * DAY), 'only videos from the last year are returned');
});
