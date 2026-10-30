import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
const bundle = await build({ entryPoints: ['src/lib/config/loadWorkspace.ts'], bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent' });
const { loadWorkspace, WorkspaceSetupError } = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const config = { mode:'cloud',supabaseUrl:'https://example.invalid',supabasePublishableKey:'sb_publishable_'+'example'.repeat(4) };
test('temporary startup transport failure retries a read without calling it a setup error', async () => {
 let calls=0;const result=await loadWorkspace(async (_url,options)=>{assert.ok(options.signal);if(++calls===1)throw new TypeError('Failed to fetch');return Response.json(config);});
 assert.equal(result.mode,'cloud');assert.equal(calls,2);
});
test('explicit missing configuration stays an actionable setup error', async () => {
 let calls=0;await assert.rejects(loadWorkspace(async()=>{calls++;return Response.json({code:'WORKSPACE_NOT_CONFIGURED'},{status:503});}), WorkspaceSetupError);assert.equal(calls,1);
});
test('invalid successful configuration never initializes the workspace',async()=>{
 await assert.rejects(loadWorkspace(async()=>Response.json({mode:'cloud'})),WorkspaceSetupError);
});
