import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const out = await build({
  entryPoints: ['./src/lib/references/personReferences.ts'],
  absWorkingDir: fileURLToPath(new URL('..', import.meta.url)),
  bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent',
});
const { addSavedPersonToDraft } = await import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'));

const refs = n => Array.from({ length: n }, (_, i) => ({ id: `r${i}`, data: `data:image/png;base64,${i}`, mimeType: 'image/png' }));
const draft = n => ({ prompt: 'a portrait', referenceImages: refs(n), personGroups: [] });
const person = photos => ({ id: 'p1', name: 'Ada', isMe: false, photos: Array.from({ length: photos }, (_, i) => ({ id: `ph${i}`, data: `data:image/png;base64,ada${i}`, mimeType: 'image/png' })) });
const message = (n, photos) => { try { addSavedPersonToDraft(draft(n), person(photos), 14); } catch (e) { return e.message; } return ''; };

test('a two-photo person on a full composer says 2 more photo slots', () => {
  assert.match(message(14, 2), /needs 2 more photo slots;/);
});

test('a one-photo person on a full composer says 1 more photo slot', () => {
  assert.match(message(14, 1), /needs 1 more photo slot;/);
});

const linked = n => ({ prompt: 'a portrait', referenceImages: refs(n), personGroups: [{ id: 1, name: 'Ada', savedPersonId: 'p1' }] });
const updateMessage = (n, photos) => { try { addSavedPersonToDraft(linked(n), person(photos), 14); } catch (e) { return e.message; } return ''; };

test('updating a linked one-photo person on a full composer says 1 photo slot', () => {
  assert.match(updateMessage(14, 1), /needs 1 photo slot;/);
});

test('updating a linked two-photo person on a full composer says 2 photo slots', () => {
  assert.match(updateMessage(13, 2), /needs 2 photo slots;/);
});
