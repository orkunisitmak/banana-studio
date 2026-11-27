import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// Gallery is too large to mount without a DOM, so the close effect is checked at the source level (CRLF tolerant).
const src = fs.readFileSync(new URL('../src/components/Gallery.tsx', import.meta.url), 'utf8');
const handler = src.match(/const handlePopupEscape = \(event: KeyboardEvent\) => \{\r?\n\s*if \(event\.key === 'Escape'[\s\S]*?\r?\n    \};/)?.[0];

test('Escape closes the Gallery notification panel, grid menu and account menu and refocuses the trigger', () => {
  assert.ok(handler, 'popup Escape handler not found');
  assert.match(handler, /isNotificationPanelOpen\) \{ setIsNotificationPanelOpen\(false\); notificationButtonRef\.current\?\.focus\(\); \}/);
  assert.match(handler, /isGridMenuOpen\) \{ setIsGridMenuOpen\(false\); gridMenuRef\.current\?\.querySelector\('button'\)\?\.focus\(\); \}/);
  assert.match(handler, /!event\.isComposing && !moveMenuOpen && !isCreatingFolder\) \{/, 'the Move menu and New Folder dialog keep Escape for themselves');
  assert.match(handler, /isUserMenuOpen\) \{ setIsUserMenuOpen\(false\); userMenuRef\.current\?\.querySelector\('button'\)\?\.focus\(\); \}/);
});

test('one Escape closes one layer: overlays above the header popups keep it, and a closed popup consumes it', () => {
  const guard = handler.indexOf('if (isOverlayOpenRef.current) return;');
  const consumed = handler.indexOf('event.preventDefault();');
  const firstClose = handler.indexOf('setIsNotificationPanelOpen(false)');
  assert.ok(guard > 0, 'the viewer and the other overlays must get Escape before the header popups');
  assert.ok(consumed > guard, 'Escape is only consumed when no overlay is on top');
  assert.ok(firstClose > consumed, 'the window-level viewer handler must see defaultPrevented once a popup closed');
  assert.match(handler, /if \(!isNotificationPanelOpen && !isGridMenuOpen && !isUserMenuOpen\) return;\r?\n\s*event\.preventDefault\(\);/, 'Escape is left alone when no popup is open');
  // The viewer flag mirrors the condition the viewer renders under (search and comparison count as overlays themselves).
  assert.match(src, /const isViewerOpen = Boolean\(selectedMedia && !selectedMedia\.isLoading && !isSelectionMode\);/);
  assert.match(src, /isOverlayOpenRef\.current = Boolean\(isViewerOpen \|\| comparisonIds \|\| isSearchOpen \|\| isYouTubePreviewOpen \|\| isHelpCenterOpen \|\| previewRefImage \|\| sharingFolder\);/);
  assert.match(src, /\{selectedMedia && !comparisonIds && !isSearchOpen && !isSelectionMode && !selectedMedia\.isLoading && \(/);
  const viewerKeys = src.match(/const handleKeyDown = \(e: KeyboardEvent\) => \{[\s\S]*?setSelectedMediaId\(null\);/)?.[0];
  assert.match(viewerKeys ?? '', /if \(e\.defaultPrevented \|\| e\.isComposing/, 'the viewer ignores an Escape a popup already handled');
});

test('the handler is registered and removed with the outside-click listener', () => {
  assert.match(src, /document\.addEventListener\('keydown', handlePopupEscape\);\r?\n\s*return \(\) => \{\r?\n\s*document\.removeEventListener\('mousedown', handleClickOutside\);\r?\n\s*document\.removeEventListener\('keydown', handleEscape\);\r?\n\s*document\.removeEventListener\('keydown', handlePopupEscape\);/);
});

test('opening the grid menu from the keyboard closes the notification panel and account menu', () => {
  assert.match(src, /onClick=\{\(\) => \{ setIsGridMenuOpen\(!isGridMenuOpen\); setIsNotificationPanelOpen\(false\); setIsUserMenuOpen\(false\); \}\}/);
});
