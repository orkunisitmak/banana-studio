import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// Gallery is too large to mount without a DOM, so the close effect is checked at the source level (CRLF tolerant).
const src = fs.readFileSync(new URL('../src/components/Gallery.tsx', import.meta.url), 'utf8');
const handler = src.match(/const handleEscape = \(event: KeyboardEvent\) => \{\r?\n\s*if \(event\.key === 'Escape'[\s\S]*?\r?\n    \};/)?.[0];

test('Escape closes the Gallery notification panel, grid menu and account menu and refocuses the trigger', () => {
  assert.ok(handler, 'popup Escape handler not found');
  assert.match(handler, /isNotificationPanelOpen\) \{ setIsNotificationPanelOpen\(false\); notificationButtonRef\.current\?\.focus\(\); \}/);
  assert.match(handler, /isGridMenuOpen\) \{ setIsGridMenuOpen\(false\); gridMenuRef\.current\?\.querySelector\('button'\)\?\.focus\(\); \}/);
  assert.match(handler, /isUserMenuOpen\) \{ setIsUserMenuOpen\(false\); userMenuRef\.current\?\.querySelector\('button'\)\?\.focus\(\); \}/);
});

test('the handler is registered and removed with the outside-click listener', () => {
  assert.match(src, /document\.addEventListener\('keydown', handleEscape\);\r?\n\s*return \(\) => \{\r?\n\s*document\.removeEventListener\('mousedown', handleClickOutside\);\r?\n\s*document\.removeEventListener\('keydown', handleEscape\);/);
});
