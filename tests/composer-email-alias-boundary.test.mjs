import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const load = async file => {
  const out = await build({
    entryPoints: [fileURLToPath(new URL(file, import.meta.url))],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
  });
  return import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'));
};

const { displayReferencePrompt, storeReferencePrompt } = await load('../src/lib/references/dynamicReferences.ts');
const { normalizeReferencePrompt } = await load('../src/lib/references/personReferences.ts');

const me = { id: 'a', data: 'https://x/a.png', mimeType: 'image/png', personId: 1 };
const studio = { id: 'b', data: 'https://x/b.png', mimeType: 'image/png', personId: 3, personName: 'Studio' };
const refImg = { id: 'r1', data: 'https://x/r1.png', mimeType: 'image/png' };

test('storeReferencePrompt leaves @Me.com email addresses untouched for every local-part shape', () => {
  for (const addr of ['jane@Me.com', 'name!@Me.com', 'çağrı@Me.com', 'a+b@Me.com', 'x.y@Me.com', 'user@Me.co.uk']) {
    const prompt = `Thumbnail footer: contact ${addr} in white`;
    const stored = storeReferencePrompt(prompt, [me]);
    assert.equal(stored, prompt, addr);
    assert.equal(normalizeReferencePrompt(stored, [me]), prompt, addr);
  }
});

test('storeReferencePrompt leaves emails matching a custom single-word person alias untouched', () => {
  for (const addr of ['info@Studio.com', 'support+vip@Studio.co.uk', 'team!@Studio.org']) {
    const prompt = `Email ${addr} today`;
    assert.equal(storeReferencePrompt(prompt, [studio]), prompt, addr);
  }
});

test('displayReferencePrompt does not rewrite an internal tag embedded inside a word', () => {
  assert.equal(displayReferencePrompt('prefix@MAIN_PERSON', [me]), 'prefix@MAIN_PERSON');
  assert.equal(displayReferencePrompt('çağrı@PERSON_3', [studio]), 'çağrı@PERSON_3');
});

test('real person and reference mentions next to punctuation still convert and round-trip', () => {
  const cases = [
    ['@Me on the left', '@MAIN_PERSON on the left'],
    ['Put (@Me) on the left', 'Put (@MAIN_PERSON) on the left'],
    ['-@Me smiling', '-@MAIN_PERSON smiling'],
    ['Left.@Me', 'Left.@MAIN_PERSON'],
    ['Put @Me. Then smile', 'Put @MAIN_PERSON. Then smile'],
    ['@Studio waves beside @[Reference 3]', '@PERSON_3 waves beside @REFERENCE[r1]'],
  ];
  for (const [display, stored] of cases) {
    assert.equal(storeReferencePrompt(display, [me, studio, refImg]), stored, display);
    assert.equal(displayReferencePrompt(stored, [me, studio, refImg]), display, stored);
  }
});

test('stored person tags followed by .word keep their binding across display and store round-trips', () => {
  for (const stored of ['@MAIN_PERSON.Then smile', '@PERSON_3.Then smile']) {
    const displayed = displayReferencePrompt(stored, [me, studio]);
    assert.equal(displayed, stored, stored);
    assert.equal(storeReferencePrompt(displayed, [me, studio]), stored, stored);
  }
});

test('bracketed aliases keep their trailing word boundary so suffixes do not corrupt person ids', () => {
  const spaced = { id: 's1', data: 'https://x/s1.png', mimeType: 'image/png', personId: 3, personName: 'Alex Rivera' };
  assert.equal(storeReferencePrompt('@[Alex Rivera]2', [spaced]), '@[Alex Rivera]2');
  assert.equal(storeReferencePrompt('@[Reference 1]s', [refImg]), '@[Reference 1]s');
  assert.equal(storeReferencePrompt('@[Alex Rivera] waves', [spaced]), '@PERSON_3 waves');
});
