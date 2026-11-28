import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const stubs = {
  '/authService': 'export const logUsage = async () => {};',
  '/geminiClient': 'export const getGeminiClient = () => ({ models: { generateContent: async request => { globalThis.__briefRequest = request; return { text: globalThis.__briefResponse, usageMetadata: {} }; } } });',
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
  try { return await analyzeYouTubeVideo(video, 'data:image/jpeg;base64,AAAA', { model: 'gpt-6.2-sol', brainstormNoText: true }); }
  finally { delete globalThis.__briefResponse; }
};

test('video analysis keeps a late premise entry within the six-entry evidence cap', async () => {
  const context = [1, 2, 3, 4, 5, 6].map(minute => entry(minute, 'context'));
  const analysis = await analyze([...context, entry(7, 'premise')]);
  assert.equal(analysis.analysisModel, 'gemini-4-hydrogen', 'the user’s creative model does not trigger a second editorial call');
  assert.equal(globalThis.__briefRequest.model, 'gemini-4-hydrogen');
  assert.equal(globalThis.__briefRequest.config.thinkingConfig.thinkingLevel, 'HIGH');
  assert.deepEqual(globalThis.__briefRequest.contents.parts[0], { fileData: { fileUri: 'https://www.youtube.com/watch?v=abcdefghijk' }, videoMetadata: { fps: 0.1 }, mediaResolution: { level: 'MEDIA_RESOLUTION_LOW' } });
  assert.deepEqual(analysis.evidence.map(item => item.timestamp), ['01:00', '02:00', '03:00', '04:00', '05:00', '07:00']);
  assert.equal(analysis.evidence.at(-1).relevance, 'premise');

  const early = await analyze([entry(1, 'premise'), ...context.slice(1), entry(7, 'context')]);
  assert.deepEqual(early.evidence.map(item => item.timestamp), ['01:00', '02:00', '03:00', '04:00', '05:00', '06:00']);

  await assert.rejects(analyze([...context, entry(7, 'context')]), /no evidence for the main episode premise/);
});
