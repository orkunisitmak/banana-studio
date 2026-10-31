import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const source = fileURLToPath(new URL('../src/lib/references/mediaUploadLimits.ts', import.meta.url));
const bundled = await build({ entryPoints: [source], bundle: true, write: false, format: 'esm', platform: 'node' });
const { MAX_VIDEO_UPLOAD_BYTES } = await import('data:text/javascript;base64,' + Buffer.from(bundled.outputFiles[0].text).toString('base64'));

test('local Supabase accepts the full supported reference-video size', () => {
  const config = fs.readFileSync(new URL('../supabase/config.toml', import.meta.url), 'utf8');
  const storage = config.match(/^\[storage\]\s*\n([\s\S]*?)(?=^\[)/m)?.[1];
  const limitMiB = Number(storage?.match(/^file_size_limit\s*=\s*"(\d+)MiB"/m)?.[1]);
  assert.equal(limitMiB * 1024 * 1024, MAX_VIDEO_UPLOAD_BYTES);
});

test('the bucket migration and browser share the same maximum object size', () => {
  const migration = fs.readFileSync(new URL('../supabase/migrations/20261030140000_media_bucket_upload_limits.sql', import.meta.url), 'utf8');
  const cap = Number(migration.match(/least\(coalesce\(file_size_limit, (\d+)\), \1\)/)?.[1]);
  assert.equal(cap, MAX_VIDEO_UPLOAD_BYTES);
});
