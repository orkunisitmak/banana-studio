import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const out = await build({ entryPoints: [fileURLToPath(new URL('../src/lib/references/personReferences.ts', import.meta.url))], bundle: true, write: false, format: 'esm', platform: 'node' });
const { normalizeReferencePrompt, mergePersonReferenceInputs, addSavedPersonToDraft } = await import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'));

const me = { id: 'a', data: 'https://x/a.png', mimeType: 'image/png', personId: 1 };
const email = 'Thumbnail footer: contact jane@me.com in small white type';

test('an @me.com email is plain text when no main person is attached', () => {
  assert.equal(normalizeReferencePrompt(email, []), email);
});

test('an @me.com email is not rewritten when a main person is attached', () => {
  assert.equal(normalizeReferencePrompt(email, [me]), email);
});

test('a real @ME mention still resolves, including next to punctuation', () => {
  for (const prompt of ['@ME on the left', 'Put (@ME) on the left', 'Put @me, smiling']) {
    const out = normalizeReferencePrompt(prompt, [me]);
    assert.match(out, /the main person shown in image 1/, prompt);
  }
  assert.throws(() => normalizeReferencePrompt('@ME on the left', []), /kişi referansı yok/);
});

test('merging templates leaves an @me.com email alone and still maps a real @ME', () => {
  const guest = { id: 'g', data: 'https://x/g.png', mimeType: 'image/png', personId: 1 };
  assert.equal(mergePersonReferenceInputs([], [], 'Mail jane@me.com', 'and bob@me.com').prompt, 'Mail jane@me.com and bob@me.com');
  assert.match(mergePersonReferenceInputs([me], [guest], 'Intro', '@ME waves').prompt, /@MAIN_PERSON waves/);
});

test('adding a saved person to a draft with an @me.com email still offers the Me identity', () => {
  const person = { id: 'p', name: 'Me', isMe: true, photos: [{ id: '1', data: 'https://x/p.png', mimeType: 'image/png' }] };
  const draft = addSavedPersonToDraft({ referenceImages: [], personGroups: [], prompt: email, originalPrompt: email }, person, 5);
  assert.equal(draft.referenceImages[0].personId, 1);
});
