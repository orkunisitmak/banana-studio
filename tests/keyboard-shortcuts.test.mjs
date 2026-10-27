import test from 'node:test';
import assert from 'node:assert/strict';
import { isGenerationShortcut } from '../src/lib/keyboardShortcuts.ts';

const event = (overrides = {}) => ({
  key: 'Enter',
  ctrlKey: true,
  metaKey: false,
  repeat: false,
  isComposing: false,
  ...overrides,
});

test('generation shortcut accepts Control and Command Enter', () => {
  assert.equal(isGenerationShortcut(event()), true);
  assert.equal(isGenerationShortcut(event({ ctrlKey: false, metaKey: true })), true);
});

test('generation shortcut rejects repeat and IME composition', () => {
  assert.equal(isGenerationShortcut(event({ repeat: true })), false);
  assert.equal(isGenerationShortcut(event({ isComposing: true })), false);
});

test('generation shortcut rejects unrelated keys and modifiers', () => {
  assert.equal(isGenerationShortcut(event({ key: 'Escape' })), false);
  assert.equal(isGenerationShortcut(event({ ctrlKey: false })), false);
});
