import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const compiled = await build({entryPoints:['src/services/youtubeService.ts'],absWorkingDir:fileURLToPath(new URL('..',import.meta.url)),bundle:true,write:false,format:'esm',platform:'node',logLevel:'silent',
  plugins:[{name:'fixture',setup(b){
    b.onResolve({filter:/\/authService$/},()=>({path:'auth',namespace:'fixture'}));
    b.onLoad({filter:/.*/,namespace:'fixture'},()=>({loader:'js',contents:'export const supabase={};'}));
  }}]});
const { formatViewCount } = await import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text).toString('base64'));

test('view counts that round up move to the next unit', () => {
  assert.equal(formatViewCount(999_950), '1.0M');
  assert.equal(formatViewCount(999_999), '1.0M');
  assert.equal(formatViewCount(999_950_000), '1.0B');
  assert.equal(formatViewCount(15_300_000_000), '15.3B');
});

test('other view counts keep their format', () => {
  assert.deepEqual([0, 999, 1_000, 12_345, 999_949, 1_000_000, 2_450_000, 999_949_999].map(formatViewCount),
    ['0', '999', '1.0K', '12.3K', '999.9K', '1.0M', '2.5M', '999.9M']);
});
