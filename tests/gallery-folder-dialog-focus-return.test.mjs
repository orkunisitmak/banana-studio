import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// Gallery is too large to mount without a DOM, so the handlers are checked at the source level (CRLF tolerant).
const src = fs.readFileSync(new URL('../src/components/Gallery.tsx', import.meta.url), 'utf8');
const focusOpener = 'createFolderOpenerRef\\.current\\?\\.focus\\(\\{ preventScroll: true \\}\\);';

test('opening the New Folder dialog records the element that opened it', () => {
  assert.match(src, /createFolderOpenerRef\.current = document\.activeElement as HTMLElement \| null;\r?\n\s*setIsCreatingFolder\(true\);/);
});

test('Escape, Cancel/backdrop and a successful create all return focus to that element', () => {
  assert.match(src, new RegExp(`event\\.key === 'Escape' && !isSavingFolder\\) \\{\\r?\\n\\s*setIsCreatingFolder\\(false\\);\\r?\\n\\s*${focusOpener}`));
  assert.match(src, new RegExp(`const closeCreateFolderModal = \\(\\) => \\{\\r?\\n\\s*if \\(isSavingFolder\\) return;\\r?\\n\\s*setIsCreatingFolder\\(false\\);\\r?\\n\\s*${focusOpener}`));
  assert.match(src, new RegExp(`setNewFolderName\\(""\\);\\r?\\n\\s*setIsCreatingFolder\\(false\\);\\r?\\n\\s*${focusOpener}\\r?\\n\\s*\\} catch`));
});
