import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

const load = async file => {
  const compiled = await build({ entryPoints: [fileURLToPath(new URL(file, import.meta.url))], bundle: true, write: false, format: 'esm', platform: 'node' });
  return import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64'));
};
const { prepareSeedanceFramePrompt } = await load('../src/lib/video/seedanceFrames.ts');
const { falSeedanceInput, openRouterSeedanceInput } = await load('../src/lib/video/seedanceProviders.ts');
const request = prompt => ({ videoModel: 'seedance-2.5', mode: 'image_to_video', prompt, duration: 8, quality: '720p', aspectRatio: '16:9', imageUrls: ['https://example.invalid/start.png'] });

for (const [provider, prepare] of [['fal', body => falSeedanceInput(body).input], ['OpenRouter', openRouterSeedanceInput]]) {
  test(`${provider} retains quoted frame copy through final provider payload preparation`, () => {
    const literal = 'Print "@IMAGE_9", “@REF_IMAGE_2”, and \'don\'t change @AUDIO_3\'.';
    const prepared = prepareSeedanceFramePrompt(`${literal} Animate @FIRST_FRAME.`, [{ id: 'start', isFirstFrame: true }]);
    assert.ok(prepared.endsWith(`${literal} Animate the provided first frame.`));
    assert.equal(prepare(request(prepared)).prompt, prepared);
  });

  test(`${provider} translates unquoted references while preserving adjacent literal aliases`, () => {
    const prompt = 'Use @REF_IMAGE_1 with @VIDEO_2 and @AUDIO_3. Say "@REF_IMAGE_1 @VIDEO_2 @AUDIO_3".';
    assert.equal(prepare(request(prompt)).prompt,
      'Use @Image1 with @Video2 and @Audio3. Say "@REF_IMAGE_1 @VIDEO_2 @AUDIO_3".');
    assert.equal(prepare(request('John\'s @IMAGE_1; "@VIDEO_2')).prompt, 'John\'s @Image1; "@Video2');
    assert.equal(prepare(request(undefined)).prompt, '');
  });
}

test('the provider module loads in Node without a bundler and keeps the shared quoted-copy pattern', async () => {
  const direct = await import('../src/lib/video/seedanceProviders.ts');
  assert.equal(direct.openRouterSeedanceInput(request('Say "@IMAGE_1" over @IMAGE_1.')).prompt, 'Say "@IMAGE_1" over @Image1.');
  const read = file => readFileSync(new URL(file, import.meta.url), 'utf8');
  const pattern = read('../src/lib/references/referenceTokens.ts').match(/getQuotedPromptPattern = \(\): RegExp => (\/.*\/gu);/)[1];
  assert.ok(read('../src/lib/video/seedanceProviders.ts').includes(`=> ${pattern};`));
});
