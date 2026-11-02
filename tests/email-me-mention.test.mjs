import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const out = await build({ entryPoints: [fileURLToPath(new URL('../src/lib/references/personReferences.ts', import.meta.url))], bundle: true, write: false, format: 'esm', platform: 'node' });
const { normalizeReferencePrompt, mergePersonReferenceInputs, addSavedPersonToDraft } = await import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'));

const me = { id: 'a', data: 'https://x/a.png', mimeType: 'image/png', personId: 1 };
const emails = ['name!@me.com', 'çağrı@me.com', 'a+b@ME.COM', 'x.y@me.com'].map(a => `Mail ${a} today`);
const email = 'Thumbnail footer: contact jane@me.com in small white type';

test('an @me.com email is plain text when no main person is attached', () => {
  assert.equal(normalizeReferencePrompt(email, []), email);
});

test('an @me.com email is not rewritten when a main person is attached', () => {
  assert.equal(normalizeReferencePrompt(email, [me]), email);
});

test('a real @ME mention still resolves, including next to punctuation', () => {
  for (const prompt of ['@ME on the left', 'Put (@ME) on the left', 'Put @me, smiling', '-@ME smiling', 'Left.@ME', 'Put @ME. Then smile']) {
    const out = normalizeReferencePrompt(prompt, [me]);
    assert.match(out, /the main person shown in image 1/, prompt);
  }
  assert.throws(() => normalizeReferencePrompt('@ME on the left', []), /kişi referansı yok/);
});

test('merging templates leaves an @me.com email alone and still maps a real @ME', () => {
  const guest = { id: 'g', data: 'https://x/g.png', mimeType: 'image/png', personId: 1 };
  assert.equal(mergePersonReferenceInputs([], [], 'Mail jane@me.com', 'and bob@me.com').prompt, 'Mail jane@me.com and bob@me.com');
  assert.equal(mergePersonReferenceInputs([me], [guest], 'Intro', 'Mail jane@me.com').prompt, 'Intro Mail jane@me.com');
  assert.match(mergePersonReferenceInputs([me], [guest], 'Intro', '@ME waves').prompt, /@MAIN_PERSON waves/);
});

test('adding a saved person to a draft with an @me.com email still offers the Me identity', () => {
  const person = { id: 'p', name: 'Me', isMe: true, photos: [{ id: '1', data: 'https://x/p.png', mimeType: 'image/png' }] };
  const draft = addSavedPersonToDraft({ referenceImages: [], personGroups: [], prompt: email, originalPrompt: email }, person, 5);
  assert.equal(draft.referenceImages[0].personId, 1);
});

test('emails with punctuation or non-ASCII before @me.com stay plain text in every matcher', () => {
  const guest = { id: 'g', data: 'https://x/g.png', mimeType: 'image/png', personId: 1 };
  const person = { id: 'p', name: 'Me', isMe: true, photos: [{ id: '1', data: 'https://x/p.png', mimeType: 'image/png' }] };
  for (const text of emails) {
    assert.equal(normalizeReferencePrompt(text, [me]), text, text);
    assert.equal(normalizeReferencePrompt(text, []), text, text);
    assert.equal(mergePersonReferenceInputs([me], [guest], 'Intro', text).prompt, `Intro ${text}`, text);
    const draft = addSavedPersonToDraft({ referenceImages: [], personGroups: [], prompt: text, originalPrompt: text }, person, 5);
    assert.equal(draft.referenceImages[0].personId, 1, text);
  }
});

test('a mention right after punctuation counts as present when adding a saved person', () => {
  const person = { id: 'p', name: 'Me', isMe: true, photos: [{ id: '1', data: 'https://x/p.png', mimeType: 'image/png' }] };
  for (const prompt of ['-@ME smiling', 'Left.@ME']) {
    const draft = addSavedPersonToDraft({ referenceImages: [], personGroups: [], prompt, originalPrompt: prompt }, person, 5);
    assert.notEqual(draft.referenceImages[0]?.personId, 1, prompt);
  }
});

test('merging templates maps a mention after punctuation', () => {
  const guest = { id: 'g', data: 'https://x/g.png', mimeType: 'image/png', personId: 1 };
  assert.match(mergePersonReferenceInputs([me], [guest], 'Intro', '-@ME and Left.@ME').prompt, /-@MAIN_PERSON and Left\.@MAIN_PERSON/);
});
