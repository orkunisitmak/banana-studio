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
