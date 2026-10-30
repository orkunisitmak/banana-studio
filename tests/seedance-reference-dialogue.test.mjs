import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

// No configured workspace or media upload is needed to exercise prompt preparation.
const compiled = await build({ entryPoints: [fileURLToPath(new URL('../src/services/runwayService.ts', import.meta.url))], bundle: true, write: false, format: 'esm', platform: 'node', plugins: [{ name: 'workspace-boundaries', setup(b) {
  b.onResolve({ filter: /^\.\/(authService|storageService|providerRouting)$/ }, args => ({ path: args.path, namespace: 'fixture' }));
  b.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: ({
    './authService': 'export const supabase = null; export const logUsage = () => {};',
    './storageService': 'export const uploadBase64ToPublicUrl = () => {}; export const uploadBlobToPublicUrl = () => {}; export const uploadVideoBlobToPublicUrl = () => {}; export const refreshMediaAccessUrl = () => {};',
    './providerRouting': 'export const selectProvider = () => {};',
  })[args.path] }));
} }] });
const { prepareSeedanceReferenceGenerationPrompt } = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64'));

test('reference-video generation does not rewrite spoken command words', () => {
  const prompt = 'The actor says "Never change, continue or remove anything".';
  const result = prepareSeedanceReferenceGenerationPrompt(prompt, '16:9', 1);
  assert.equal(result.slice(result.indexOf('The actor')), prompt);
});

test('quoted screen copy survives while unquoted shot instructions are rephrased', () => {
  const prompt = 'Print “DELETE” and \'don\'t change it\'. Replace jacket with coat.';
  const result = prepareSeedanceReferenceGenerationPrompt(prompt, '9:16', 2);
  assert.equal(result.slice(result.indexOf('Print ')), 'Print “DELETE” and \'don\'t change it\'. coat appears in place of jacket.');
});

test('continuation reference directions retain exact dialogue', () => {
  const result = prepareSeedanceReferenceGenerationPrompt('Say "Continue the sequel".', '16:9', 2, '@video1');
  assert.ok(result.startsWith('Create a new 16:9 shot that chronologically follows @video1\'s final visible moment.'));
  assert.equal(result.slice(result.indexOf('Say ')), 'Say "Continue the sequel".');
});

test('unquoted edit-like wording retains its existing new-shot transformation', () => {
  const result = prepareSeedanceReferenceGenerationPrompt('Extend @video1: replace jacket with coat. Remove the hat. Add rain.', '16:9', 1);
  assert.ok(result.startsWith('Create a new standalone 16:9 composition. Use @video1 only as visual reference material'));
  assert.ok(result.endsWith('Use @video1 as visual reference material. coat appears in place of jacket. the hat is absent from the new shot. The new shot features rain.'));
});

test('whole shot instructions can still move quoted noun phrases without changing their contents', () => {
  for (const [prompt, expected] of [
    ['Remove the "red hat".', 'the "red hat" is absent from the new shot.'],
    ['Replace the "red jacket" with a blue coat.', 'a blue coat appears in place of the "red jacket".'],
    ['Add the "DELETE" sign.', 'The new shot features the "DELETE" sign.'],
  ]) {
    assert.ok(prepareSeedanceReferenceGenerationPrompt(prompt, '16:9', 1).endsWith(expected), prompt);
  }
});

test('literal whitespace and placeholder-like user text survive rephrasing unchanged', () => {
  const prompt = 'A sign reads "DELETE  NOW" beside \uE0000\uE001 and \uE000\uE0001\uE001.';
  const result = prepareSeedanceReferenceGenerationPrompt(prompt, '16:9', 1);
  assert.equal(result.slice(result.indexOf('A sign')), prompt);
});
