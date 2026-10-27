import test from 'node:test';
import assert from 'node:assert/strict';
import { isStuckPendingGeneration, STUCK_PENDING_MS } from '../src/lib/gallery/stuckGeneration.ts';
import { comfyFailureMessage } from '../api/_lib/comfyuiImage.ts';

const now=1_000_000_000,old=now-STUCK_PENDING_MS-1,none=new Set();
const image=extra=>({id:'job',mediaType:'image',status:'pending',createdAt:old,imageModel:'flux3-klein-local',...extra});

test('queued image jobs waiting for a local or hosted worker are never failed by the watchdog',()=>{
  // Five 4K FLUX 3 images: jobs 3–5 wait minutes for the GPU. Each is queued, staged or owned by this tab.
  assert.equal(isStuckPendingGeneration(image({imageStage:'queued'}),now,none),false);
  assert.equal(isStuckPendingGeneration(image({imageQueue:{version:1,queuedAt:old}}),now,none),false);
  assert.equal(isStuckPendingGeneration(image(),now,new Set(['job'])),false);
  for(const model of ['gemini-3-pro-image-preview','gemini-nano-banana-2.1','flux2-klein-local'])assert.equal(isStuckPendingGeneration(image({imageModel:model,imageStage:'queued'}),now,none),false);
});

test('rows that can never progress are still failed after 90 seconds',()=>{
  assert.equal(isStuckPendingGeneration(image(),now,none),true,'legacy image row without request, queue or owner');
  assert.equal(isStuckPendingGeneration({id:'v',mediaType:'video',status:'pending',createdAt:old},now,none),true);
  assert.equal(isStuckPendingGeneration({id:'v',mediaType:'video',status:'pending',createdAt:old,taskId:'task-1'},now,none),false);
  assert.equal(isStuckPendingGeneration(image(),old+STUCK_PENDING_MS,none),false,'not before 90 seconds');
  assert.equal(isStuckPendingGeneration(image({status:'processing'}),now,none),false);
  assert.equal(isStuckPendingGeneration(image({falRequestId:'r1'}),now,none),false);
  assert.equal(isStuckPendingGeneration(image({imageModel:'gpt-image-2.5-sunburst'}),now,none),false);
});

test('a local time-out says so instead of a generic failure',()=>{
  for(const name of ['TimeoutError','AbortError'])assert.match(comfyFailureMessage(Object.assign(new Error('x'),{name})),/time limit/);
});
