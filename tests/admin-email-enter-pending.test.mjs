import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// AdminPanel needs a Supabase session to mount, so the handler is checked at the source level (CRLF tolerant).
const src = fs.readFileSync(new URL('../src/components/AdminPanel.tsx', import.meta.url), 'utf8');

test('Enter in the email field cannot start a second add while one is pending', () => {
  assert.match(src, /const handleAddEmail = async \(\) => \{\r?\n\s*if \(isAddingEmail\) return;\r?\n\s*const email/);
  assert.match(src, /onKeyDown=\{submitOnEnter\(handleAddEmail\)\}/);
});

test('the Add button stays disabled while an add is pending', () => {
  assert.match(src, /disabled=\{isAddingEmail \|\| !newEmail\.trim\(\)\}/);
});
