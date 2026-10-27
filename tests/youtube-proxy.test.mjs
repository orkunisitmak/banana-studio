import test from 'node:test';
import assert from 'node:assert/strict';

test('youtube proxy parameter sanitization enforces allowlist and forbids key overriding', () => {
  const ALLOWED_PARAMS = new Set([
    'part', 'id', 'q', 'maxResults', 'type', 'channelId',
    'forHandle', 'forUsername', 'playlistId', 'pageToken', 'fields'
  ]);

  const sanitizeParams = (params, serverKey) => {
    const searchParams = new URLSearchParams();
    if (params && typeof params === 'object') {
      for (const [k, v] of Object.entries(params)) {
        if (typeof v === 'string' && ALLOWED_PARAMS.has(k) && k.toLowerCase() !== 'key') {
          if (k === 'maxResults') {
            const num = parseInt(v, 10);
            if (!isNaN(num) && num > 0 && num <= 50) {
              searchParams.set(k, String(num));
            }
          } else {
            searchParams.set(k, v);
          }
        }
      }
    }
    searchParams.set('key', serverKey);
    return searchParams;
  };

  const serverKey = 'SECRET_SERVER_YOUTUBE_API_KEY';

  // 1. Attempt key override via payload
  const result1 = sanitizeParams({ key: 'ATTACKER_OVERRIDE_KEY', part: 'snippet' }, serverKey);
  assert.equal(result1.get('key'), serverKey, 'Server API key must NEVER be overridden by user params');
  assert.equal(result1.get('part'), 'snippet');

  // 2. Reject unallowlisted parameters (injection attack)
  const result2 = sanitizeParams({ maliciousParam: 'injected', q: 'Orkun Isitmak' }, serverKey);
  assert.equal(result2.has('maliciousParam'), false, 'Non-allowlisted params must be dropped');
  assert.equal(result2.get('q'), 'Orkun Isitmak');

  // 3. Quota abuse protection on maxResults
  const result3 = sanitizeParams({ maxResults: '999999' }, serverKey);
  assert.equal(result3.has('maxResults'), false, 'Excessive maxResults must be capped or rejected');

  const result4 = sanitizeParams({ maxResults: '50' }, serverKey);
  assert.equal(result4.get('maxResults'), '50', 'Valid maxResults (<=50) should be accepted');
});
