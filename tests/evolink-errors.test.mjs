import test from 'node:test';
import assert from 'node:assert/strict';
import { getEvoLinkErrorMessage, describeEvoLinkFailure } from '../api/_lib/evolink-errors.ts';

test('extracts top-level and nested error messages across standard API formats', () => {
  // Top-level FastAPI standard error format: {"detail": "..."}
  assert.equal(getEvoLinkErrorMessage({ detail: 'Bakiye yetersiz veya token süresi doldu' }), 'Bakiye yetersiz veya token süresi doldu');

  // Top-level details array
  assert.equal(getEvoLinkErrorMessage({ details: ['Geçersiz en-boy oranı'] }), 'Geçersiz en-boy oranı');

  // Top-level reason and description
  assert.equal(getEvoLinkErrorMessage({ reason: 'Hassas içerik tespit edildi' }), 'Hassas içerik tespit edildi');
  assert.equal(getEvoLinkErrorMessage({ description: 'Sunucu aşırı yüklü' }), 'Sunucu aşırı yüklü');

  // Standard nested object structures
  assert.equal(getEvoLinkErrorMessage({ error: { message: 'Prompt çok uzun' } }), 'Prompt çok uzun');
  assert.equal(getEvoLinkErrorMessage({ task_info: { failure_reason: 'GPU bellek yetersiz' } }), 'GPU bellek yetersiz');
  assert.equal(getEvoLinkErrorMessage({ status_message: 'İşlem iptal edildi' }), 'İşlem iptal edildi');

  // Direct string input
  assert.equal(getEvoLinkErrorMessage('Direct string error'), 'Direct string error');

  // Fallback when no extractable error exists
  assert.equal(getEvoLinkErrorMessage({}), 'Video generation failed');
  assert.equal(getEvoLinkErrorMessage(null), 'Video generation failed');
  assert.equal(getEvoLinkErrorMessage(undefined, 'Özel fallback'), 'Özel fallback');
});

test('filters out generic gateway errors in favor of specific details', () => {
  // When an upstream gateway wraps a real error with "internal server error"
  const payload = {
    error: 'internal_server_error',
    details: 'Seedance model timeout',
  };
  assert.equal(getEvoLinkErrorMessage(payload), 'Seedance model timeout');
});

test('root status codes never hide specific task or status diagnostics',()=>{
  assert.equal(getEvoLinkErrorMessage({code:'500',task_info:{failure_reason:'GPU timeout'}}),'GPU timeout');
  assert.equal(getEvoLinkErrorMessage({code:'E_FAILED',status_message:'Invalid seed value'}),'Invalid seed value');
  assert.equal(getEvoLinkErrorMessage({code:'E_FAILED'}),'E_FAILED');
});

test('task diagnostics precede root messages and validation arrays expose msg',()=>{
  assert.equal(getEvoLinkErrorMessage({message:'Task failed',task_info:{failure_reason:'GPU memory exhausted'}}),'GPU memory exhausted');
  assert.equal(getEvoLinkErrorMessage({message:'Task failed',status_message:'Reference video is invalid'}),'Reference video is invalid');
  assert.equal(getEvoLinkErrorMessage({message:'Specific root message'}),'Specific root message');
  assert.equal(getEvoLinkErrorMessage({detail:[{loc:['body','prompt'],msg:'Field required',type:'missing'}]}),'Field required');
});

test('nested codes and generic task messages never hide descriptive errors',()=>{
  assert.equal(getEvoLinkErrorMessage({message:'Field required',detail:{error:{code:'E_INVALID'},msg:'Field required'}}),'Field required');
  assert.equal(getEvoLinkErrorMessage({detail:'Task failed',task_info:{failure_reason:'GPU timeout'}}),'GPU timeout');
  assert.equal(getEvoLinkErrorMessage({detail:'Reference video is invalid',task_info:{failure_reason:'Task failed'}}),'Reference video is invalid');
  assert.equal(getEvoLinkErrorMessage({detail:{error:{code:'E_INVALID'}}}),'E_INVALID');
  assert.equal(getEvoLinkErrorMessage({task_info:{code:'E_TASK'}}),'E_TASK');
});

test('describeEvoLinkFailure formats context, detail, and taskId accurately', () => {
  const result = describeEvoLinkFailure(
    { detail: 'Yüz tespit edilemedi' },
    'Seedance video üretimi',
    'task-abc-123',
  );
  assert.equal(result, 'Seedance video üretimi: Yüz tespit edilemedi (Task: task-abc-123)');

  // Generic error format
  const genericResult = describeEvoLinkFailure(
    { error: 'internal_server_error' },
    'Seedance video üretimi',
    'task-abc-123',
  );
  assert.ok(genericResult.includes('The video provider returned an internal error without a specific reason.'));
  assert.ok(genericResult.includes('task-abc-123'));
});
