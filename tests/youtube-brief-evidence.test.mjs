import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const stubs = {
  '/authService': 'export const logUsage = async () => {};',
  '/geminiClient': 'export const getGeminiClient = () => ({ models: { generateContent: async () => ({ text: globalThis.__briefResponse, usageMetadata: {} }) } }); export const getOpenAITextClient = getGeminiClient;',
  '/imageCompression': 'export const compressBase64Image = async (data, mimeType) => ({ data, mimeType });',
  '/youtubeAnalysisCache': 'export const openYouTubeAnalysisCache = async () => null;',
};
const compiled = await build({
  entryPoints: ['src/services/youtubeBriefService.ts'],
  absWorkingDir: fileURLToPath(new URL('..', import.meta.url)),
  bundle: true, write: false, format: 'esm', platform: 'node',
  plugins: [{ name: 'brief-fixture', setup(builder) {
    builder.onResolve({ filter: /.*/ }, args => {
      const key = Object.keys(stubs).find(stub => args.path.endsWith(stub));
      return key ? { path: key, namespace: 'fixture' } : undefined;
    });
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ loader: 'js', contents: stubs[args.path] }));
  } }],
});
const { analyzeYouTubeVideo } = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64'));

const video = { id: 'abcdefghijk', title: 'Episode', channelTitle: 'Channel', description: '', tags: [], durationSeconds: 900 };
const entry = (minute, relevance) => ({ timestamp: `${String(minute).padStart(2, '0')}:00`, fact: `fact ${minute}`, relevance });
const analyze = async evidence => {
  globalThis.__briefResponse = JSON.stringify({ videoAvailable: true, brief: 'Brief.', premise: 'Premise.', evidence, limitation: '' });
  try { return await analyzeYouTubeVideo(video, 'data:image/jpeg;base64,AAAA', { model: 'gemini-3.8-flash' }); }
  finally { delete globalThis.__briefResponse; }
};

test('video analysis keeps a late premise entry within the six-entry evidence cap', async () => {
  const context = [1, 2, 3, 4, 5, 6].map(minute => entry(minute, 'context'));
  const analysis = await analyze([...context, entry(7, 'premise')]);
  assert.deepEqual(analysis.evidence.map(item => item.timestamp), ['01:00', '02:00', '03:00', '04:00', '05:00', '07:00']);
  assert.equal(analysis.evidence.at(-1).relevance, 'premise');

  const early = await analyze([entry(1, 'premise'), ...context.slice(1), entry(7, 'context')]);
  assert.deepEqual(early.evidence.map(item => item.timestamp), ['01:00', '02:00', '03:00', '04:00', '05:00', '06:00']);

  await assert.rejects(analyze([...context, entry(7, 'context')]), /no evidence for the main episode premise/);
});
