import test from 'node:test';
import assert from 'node:assert/strict';
import { isReferenceUrl, isSecureReferenceUrl } from '../api/_lib/providerMedia.ts';

const hasInvalidMediaUrls = (urls) => urls != null && (
  !Array.isArray(urls)
  || urls.some(url => !isReferenceUrl(url))
);

test('isReferenceUrl accepts valid public HTTPS URLs', () => {
  assert.equal(isReferenceUrl('https://example.com/image.png'), true);
  assert.equal(isReferenceUrl('https://cdn.banana.studio/assets/video.mp4?v=1'), true);
  assert.equal(isReferenceUrl('https://storage.googleapis.com/bucket/file.jpg'), true);
});

test('isReferenceUrl rejects unencrypted HTTP URLs and invalid schemes', () => {
  assert.equal(isReferenceUrl('http://example.com/insecure.png'), false);
  assert.equal(isReferenceUrl('ftp://example.com/file.mp4'), false);
  assert.equal(isReferenceUrl('file:///etc/passwd'), false);
  assert.equal(isReferenceUrl('javascript:alert(1)'), false);
});

test('isReferenceUrl rejects URLs with embedded user credentials', () => {
  assert.equal(isReferenceUrl('https://user:pass@example.com/image.png'), false);
  assert.equal(isReferenceUrl('https://admin@example.com/image.png'), false);
});

test('isReferenceUrl rejects data and blob URLs', () => {
  assert.equal(isReferenceUrl('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAE='), false);
  assert.equal(isReferenceUrl('blob:https://example.com/uuid'), false);
});

test('isReferenceUrl rejects non-string and malformed inputs', () => {
  assert.equal(isReferenceUrl(''), false);
  assert.equal(isReferenceUrl('https://'), false);
  assert.equal(isReferenceUrl('not-a-url'), false);
  assert.equal(isReferenceUrl(null), false);
  assert.equal(isReferenceUrl(undefined), false);
  assert.equal(isReferenceUrl(123), false);
  assert.equal(isReferenceUrl({}), false);
});

test('isSecureReferenceUrl verifies protocol exactness', () => {
  assert.equal(isSecureReferenceUrl(new URL('https://example.com/asset.png')), true);
  assert.equal(isSecureReferenceUrl(new URL('http://example.com/asset.png')), false);
});

test('hasInvalidMediaUrls accepts null, undefined, or empty arrays for optional references', () => {
  assert.equal(hasInvalidMediaUrls(null), false);
  assert.equal(hasInvalidMediaUrls(undefined), false);
  assert.equal(hasInvalidMediaUrls([]), false);
});

test('hasInvalidMediaUrls accepts arrays of valid HTTPS URLs', () => {
  assert.equal(hasInvalidMediaUrls([
    'https://example.com/frame1.png',
    'https://example.com/frame2.png',
  ]), false);
});

test('hasInvalidMediaUrls rejects non-array inputs when provided', () => {
  assert.equal(hasInvalidMediaUrls('https://example.com/single.png'), true);
  assert.equal(hasInvalidMediaUrls({ url: 'https://example.com/img.png' }), true);
});

test('hasInvalidMediaUrls rejects arrays containing insecure HTTP, credentials, or malformed entries', () => {
  assert.equal(hasInvalidMediaUrls(['http://insecure.example.com/img.png']), true);
  assert.equal(hasInvalidMediaUrls(['https://user:pass@example.com/img.png']), true);
  assert.equal(hasInvalidMediaUrls(['data:image/png;base64,abc']), true);
  assert.equal(hasInvalidMediaUrls(['https://valid.example.com/img.png', 'http://insecure.example.com/img.png']), true);
});
