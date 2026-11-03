import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// Gallery is too large to mount without a DOM, so the close effect is checked at the source level (CRLF tolerant).
const src = fs.readFileSync(new URL('../src/components/Gallery.tsx', import.meta.url), 'utf8');
const effect = src.match(/const handleEscape = \(event: KeyboardEvent\) => \{\r?\n\s*if \(!moveMenuOpen[\s\S]*?\}, \[isGridMenuOpen, isNotificationPanelOpen, isUserMenuOpen, moveMenuOpen\]\);/)?.[0];

test('the Gallery Move menu closes on Escape and gives focus back to its trigger', () => {
  assert.ok(effect, 'Move menu Escape handler not found');
  assert.match(effect, /event\.key !== 'Escape'/);
  assert.match(effect, /setMoveMenuOpen\(false\);\r?\n\s*moveButtonRef\.current\?\.focus\(\)/);
  assert.match(effect, /document\.addEventListener\('keydown', handleEscape\)/);
  assert.match(effect, /document\.removeEventListener\('keydown', handleEscape\)/);
});

test('the Move trigger carries the ref the handler focuses', () => {
  assert.match(src, /<button\r?\n\s*ref=\{moveButtonRef\}\r?\n\s*onClick=\{\(\) => setMoveMenuOpen/);
});
