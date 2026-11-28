import test from 'node:test';
import assert from 'node:assert/strict';
import { createImageGenerationQueue, createImageStageNotifier } from '../src/lib/images/imageGenerationQueue.ts';

test('a throwing queued-stage observer cannot strand the image job before it starts', async () => {
  const queue = createImageGenerationQueue();
  const seen = [];
  const result = await queue.run('user', 'image-1', async ticket => {
    ticket.generating();
    return 'provider accepted';
  }, stage => { seen.push(stage); throw new Error('UI progress component unavailable'); });

  assert.equal(result, 'provider accepted');
  assert.deepEqual(seen, ['queued'], 'a failed observer is detached instead of running again');
  assert.equal(await queue.run('user', 'image-2', async () => 'next image'), 'next image');
});

test('a failing duplicate observer cannot break the other listeners or the shared job', async () => {
  const queue = createImageGenerationQueue();
  const events = [];
  const original = queue.run('user', 'image-1', async ticket => {
    ticket.generating();
    return 42;
  }, stage => events.push('healthy:' + stage));
  const duplicate = queue.run('user', 'image-1', async () => {
    throw new Error('Duplicated paid provider call');
  }, () => { throw new Error('Detached progress listener'); });

  assert.equal(await original, 42);
  assert.equal(await duplicate, 42);
  assert.deepEqual(events, ['healthy:queued', 'healthy:generating']);
});

test('a broken observer is detached across queue, direct acceptance, and polling notifications', async () => {
  const queue = createImageGenerationQueue();
  const stages = [];
  const notify = createImageStageNotifier(stage => {
    stages.push(stage);
    throw new Error('UI stage observer crashed');
  });
  const accepted = await queue.run('owner', 'accepted-job', async ticket => {
    ticket.generating();
    return 'provider accepted';
  }, () => notify('preparing'));

  assert.equal(accepted, 'provider accepted');
  assert.doesNotThrow(() => notify('queued'), 'direct acceptance notification must be safe');
  assert.doesNotThrow(() => notify('generating'), 'polling notification must be safe');
  assert.deepEqual(stages, ['preparing'], 'the first error detaches all later notifications');
});

test('one listener throwing during generating does not block another listener on the same dispatch', async () => {
  const queue = createImageGenerationQueue();
  const failedStages = [];
  const healthyStages = [];
  let continueWork;
  const ready = new Promise(resolve => { continueWork = resolve; });
  const first = queue.run('owner', 'shared-job', async ticket => {
    await ready;
    ticket.generating();
    ticket.generating();
    return 'accepted once';
  }, stage => {
    failedStages.push(stage);
    if (stage === 'generating') throw new Error('progress view failed');
  });
  const second = queue.run('owner', 'shared-job', async () => {
    throw new Error('provider must not run twice');
  }, stage => healthyStages.push(stage));
  continueWork();

  assert.equal(await first, 'accepted once');
  assert.equal(await second, 'accepted once');
  assert.deepEqual(failedStages, ['queued', 'generating']);
  assert.deepEqual(healthyStages, ['queued', 'generating', 'generating']);
});

test('resumeOpenAIImage detaches a throwing stage observer without interrupting saved-job polling', async () => {
  // Bundle the real service while stubbing only external dependencies. No provider call or real auth.
  const { build } = await import('esbuild');
  const { fileURLToPath } = await import('node:url');
  const stubs = {
    './providerRouting': 'export const selectProvider=async()=>"openai";',
    '../lib/prompts/promptPreparation': 'export const normalizePromptPreparation=value=>value;',
    '../lib/references/referenceImages': 'export const withoutLegacyMask=value=>value;',
    './authService': 'export const supabase={auth:{refreshSession:async()=>({data:{session:null}})}}; export const getSession=async()=>({access_token:"synthetic",user:{id:"owner"},expires_at:9999999999});',
    '../lib/shared/transientRead': 'export const isTransientReadError=()=>false;',
    './storageService': 'export const getImageById=async id=>globalThis.__imageObserverTestRead(id); export const uploadBase64ToPublicUrl=async()=>""; export const refreshMediaAccessUrl=async()=>"";',
    '../lib/images/imageProgress': 'export const estimateImageProgress=()=>0.5;',
    '../lib/references/referenceUploadCache': 'export const createReferenceUploader=()=>async()=>"";',
    '../lib/images/imagePrompting': 'export const validateImageGenerationReferences=()=>{};',
  };
  const compiled = await build({
    entryPoints: ['src/services/openaiImageService.ts'],
    absWorkingDir: fileURLToPath(new URL('..', import.meta.url)),
    bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent',
    plugins: [{
      name: 'image-observer-test-dependencies',
      setup(b) {
        b.onResolve({filter:/^\./}, args => Object.hasOwn(stubs,args.path) ? {path:args.path,namespace:'observer-stub'} : undefined);
        b.onLoad({filter:/.*/,namespace:'observer-stub'}, args => ({contents:stubs[args.path],loader:'js'}));
      },
    }],
  });
  const { resumeOpenAIImage } = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64'));
  const rowPlan = new Map([
    ['bad-generating', ['processing','processing','completed']],
    ['bad-queued', ['pending','processing','completed']],
    ['healthy-generating', ['processing','processing','completed']],
  ]);
  const reads = new Map();
  const previousRead = globalThis.__imageObserverTestRead;
  globalThis.__imageObserverTestRead = async id => {
    const step = reads.get(id) || 0;
    reads.set(id,step+1);
    const statuses = rowPlan.get(id);
    assert.ok(statuses,'Unexpected saved image ID');
    const status = statuses[Math.min(step,statuses.length-1)];
    return {id,status,url:status==='completed'?'https://example.test/saved-image.png':''};
  };
  const pending = id => ({id,createdAt:Date.now(),status:'pending',imageQueue:{version:1,queuedAt:Date.now()}});
  try {
    const thrownGenerating = [];
    const thrownQueued = [];
    const healthy = [];
    // Requests share no state: they only read the same-id saved row and never enqueue a paid job.
    const [a,b,c] = await Promise.all([
      resumeOpenAIImage(pending('bad-generating'),undefined,stage=>{
        thrownGenerating.push(stage);
        throw new Error('UI listener unavailable during generating');
      }),
      resumeOpenAIImage(pending('bad-queued'),undefined,stage=>{
        thrownQueued.push(stage);
        throw new Error('UI listener unavailable during queued');
      }),
      resumeOpenAIImage(pending('healthy-generating'),undefined,stage=>healthy.push(stage)),
    ]);
    for(const result of [a,b,c]) assert.equal(result.url,'https://example.test/saved-image.png');
    assert.deepEqual(thrownGenerating,['generating'],'throwing generating observer must detach after its first error');
    assert.deepEqual(thrownQueued,['queued'],'throwing queued observer must detach before generating');
    assert.deepEqual(healthy,['generating','generating'],'healthy observer receives every poll update');
    for(const id of rowPlan.keys()) assert.equal(reads.get(id),3,'polling continues to saved completion');
  } finally {
    if(previousRead===undefined) delete globalThis.__imageObserverTestRead;
    else globalThis.__imageObserverTestRead=previousRead;
  }
});
