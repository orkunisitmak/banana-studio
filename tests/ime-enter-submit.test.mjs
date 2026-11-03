import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const compiled = await build({ stdin: { contents: `export * from './src/components/submitOnEnter';`, resolveDir: fileURLToPath(new URL('..', import.meta.url)), loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent' });
const { submitOnEnter } = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64'));

const press = (key, isComposing, keyCode = key === 'Enter' ? 13 : 65) => {
  let calls = 0;
  submitOnEnter(() => { calls += 1; })({ key, keyCode, nativeEvent: { isComposing } });
  return calls;
};

test('Enter submits the field', () => assert.equal(press('Enter', false), 1));
test('Enter that confirms an IME composition does not submit', () => assert.equal(press('Enter', true), 0));
test('other keys do not submit', () => assert.equal(press('a', false), 0));
test('Enter after Safari already ended the composition (keyCode 229) does not submit', () => assert.equal(press('Enter', false, 229), 0));
test('keyCode 229 on a non-Enter key does not submit', () => assert.equal(press('a', false, 229), 0));
test('Enter with keyCode 229 and isComposing true does not submit', () => assert.equal(press('Enter', true, 229), 0));
