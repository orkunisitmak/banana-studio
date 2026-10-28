import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const bundle = await build({
  entryPoints: ['src/lib/video/frameCapture.ts'],
  absWorkingDir: fileURLToPath(new URL('..', import.meta.url)),
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
});
const {
  FrameCaptureError,
  MAX_FRAME_EDGE,
  buildFrameFilename,
  captureFrameFromUrl,
  captureVideoFrame,
  clampTimestamp,
  computeFrameDimensions,
  formatFrameTimestamp,
  getFrameCaptureErrorMessage,
  inferAspectRatio,
  inferResolutionLabel,
  sanitizeFilenamePart,
} = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);

const codeOf = (fn) => {
  try {
    fn();
  } catch (error) {
    assert.ok(error instanceof FrameCaptureError, `expected FrameCaptureError, got ${error}`);
    return error.code;
  }
  assert.fail('expected the call to throw');
};

test('clampTimestamp clamps negative and beyond-duration values', () => {
  assert.equal(clampTimestamp(-4, 10), 0);
  assert.equal(clampTimestamp(4, 10), 4);
  assert.equal(clampTimestamp(10, 10), 10);
  assert.equal(clampTimestamp(10.5, 10), 10);
  assert.equal(clampTimestamp(0, 0.001), 0);
});

test('clampTimestamp rejects NaN timestamps and missing or zero durations', () => {
  assert.equal(codeOf(() => clampTimestamp(Number.NaN, 10)), 'invalid-timestamp');
  assert.equal(codeOf(() => clampTimestamp(Number.POSITIVE_INFINITY, 10)), 'invalid-timestamp');
  assert.equal(codeOf(() => clampTimestamp(1, Number.NaN)), 'invalid-duration');
  assert.equal(codeOf(() => clampTimestamp(1, 0)), 'invalid-duration');
  assert.equal(codeOf(() => clampTimestamp(1, -2)), 'invalid-duration');
  assert.equal(codeOf(() => clampTimestamp(1, Number.POSITIVE_INFINITY)), 'invalid-duration');
});

test('computeFrameDimensions preserves the aspect ratio and caps the longest edge', () => {
  assert.deepEqual(computeFrameDimensions(1920, 1080), { width: 1920, height: 1080 });
  assert.deepEqual(computeFrameDimensions(3840, 2160), { width: 2048, height: 1152 });
  assert.deepEqual(computeFrameDimensions(2160, 3840), { width: 1152, height: 2048 });
  assert.deepEqual(computeFrameDimensions(1000, 4000), { width: 512, height: 2048 });
  assert.deepEqual(computeFrameDimensions(4096, 2160, 1024), { width: 1024, height: 540 });
  assert.equal(MAX_FRAME_EDGE, 2048);

  for (const [width, height] of [[3840, 2160], [2160, 3840], [1000, 4000], [17, 9999]]) {
    const result = computeFrameDimensions(width, height);
    assert.ok(Math.max(result.width, result.height) <= MAX_FRAME_EDGE);
    assert.ok(Math.abs(result.width / result.height - width / height) < 0.01);
  }
});

test('computeFrameDimensions rejects unusable dimensions', () => {
  assert.equal(codeOf(() => computeFrameDimensions(0, 1080)), 'invalid-dimensions');
  assert.equal(codeOf(() => computeFrameDimensions(1920, Number.NaN)), 'invalid-dimensions');
  assert.equal(codeOf(() => computeFrameDimensions(1920, 1080, 0)), 'invalid-dimensions');
});

test('filename sanitization transliterates Turkish characters and blocks traversal', () => {
  assert.equal(sanitizeFilenamePart('Çekim Şubat İstanbul Ğüşi Ödül'), 'cekim-subat-istanbul-gusi-odul');
  assert.equal(sanitizeFilenamePart('../../etc/passwd'), 'etc-passwd');
  assert.equal(sanitizeFilenamePart('..\\..\\Windows\\System32'), 'windows-system32');
  assert.equal(sanitizeFilenamePart('a/b\\c:d*e?f"g<h>i|j'), 'a-b-c-d-e-f-g-h-i-j');
  assert.equal(sanitizeFilenamePart('   '), 'video');
  assert.equal(sanitizeFilenamePart('', 'fallback'), 'fallback');
  assert.ok(sanitizeFilenamePart('x'.repeat(500)).length <= 80);
});

test('buildFrameFilename records the source and timestamp deterministically', () => {
  assert.equal(formatFrameTimestamp(0), '00-00-00.000');
  assert.equal(formatFrameTimestamp(12.345), '00-00-12.345');
  assert.equal(formatFrameTimestamp(3723.5), '01-02-03.500');
  assert.equal(
    buildFrameFilename('Çekim 01', 12.345),
    'video-cekim-01-frame-00-00-12.345.png',
  );
  assert.equal(buildFrameFilename('../../secret', 2), 'video-secret-frame-00-00-02.000.png');
  assert.equal(buildFrameFilename('clip', 1.5, 'webp'), 'video-clip-frame-00-00-01.500.webp');
  assert.equal(codeOf(() => buildFrameFilename('clip', Number.NaN)), 'invalid-timestamp');
  assert.equal(codeOf(() => buildFrameFilename('clip', -1)), 'invalid-timestamp');
});

test('inferred gallery metadata follows frame dimensions', () => {
  assert.equal(inferAspectRatio(1920, 1080), '16:9');
  assert.equal(inferAspectRatio(1080, 1920), '9:16');
  assert.equal(inferAspectRatio(1000, 1000), '1:1');
  assert.equal(inferAspectRatio(1600, 1200), '4:3');
  assert.equal(inferResolutionLabel(1024, 768), '1K');
  assert.equal(inferResolutionLabel(2048, 1152), '2K');
  assert.equal(inferResolutionLabel(4096, 2160), '4K');
});

test('capture failures are reported without producing a file', () => {
  assert.equal(codeOf(() => captureVideoFrame(null)), 'metadata-unavailable');
  assert.equal(codeOf(() => captureVideoFrame({ readyState: 0 })), 'metadata-unavailable');
  assert.equal(codeOf(() => captureVideoFrame({
    readyState: 2, videoWidth: 0, videoHeight: 0, currentTime: 1, duration: 5,
  })), 'metadata-unavailable');
  assert.equal(codeOf(() => captureVideoFrame({
    readyState: 2, videoWidth: 640, videoHeight: 360, currentTime: 1, duration: 0,
  })), 'invalid-duration');

  const previousDocument = globalThis.document;
  try {
    delete globalThis.document;
    assert.equal(codeOf(() => captureVideoFrame({
      readyState: 2, videoWidth: 640, videoHeight: 360, currentTime: 1, duration: 5,
    })), 'unsupported');

    const video = { readyState: 2, videoWidth: 640, videoHeight: 360, currentTime: 1, duration: 5 };
    globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => null }) };
    assert.equal(codeOf(() => captureVideoFrame(video)), 'canvas-unavailable');

    globalThis.document = { createElement: () => ({
      width: 0, height: 0,
      getContext: () => ({ drawImage() {} }),
      toDataURL: () => { throw new Error('SecurityError'); },
    }) };
    assert.equal(codeOf(() => captureVideoFrame(video)), 'tainted-video');

    globalThis.document = { createElement: () => ({
      width: 0, height: 0,
      getContext: () => ({ drawImage() { throw new Error('tainted'); } }),
      toDataURL: () => 'data:image/png;base64,AAAA',
    }) };
    assert.equal(codeOf(() => captureVideoFrame(video)), 'tainted-video');

    globalThis.document = { createElement: () => ({
      width: 0, height: 0,
      getContext: () => ({ drawImage() {} }),
      toDataURL: () => 'data:,',
    }) };
    assert.equal(codeOf(() => captureVideoFrame(video)), 'empty-frame');

    globalThis.document = { createElement: () => ({
      width: 0, height: 0,
      getContext: () => ({ drawImage() {} }),
      toDataURL: () => 'data:image/png;base64,',
    }) };
    assert.equal(codeOf(() => captureVideoFrame(video)), 'empty-frame');
  } finally {
    globalThis.document = previousDocument;
  }
});

test('a valid capture returns a bounded PNG payload with its timestamp', () => {
  const previousDocument = globalThis.document;
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => ({ drawImage() {} }),
    toDataURL: () => 'data:image/png;base64,AAAA',
  };
  try {
    globalThis.document = { createElement: () => canvas };
    const frame = captureVideoFrame({
      readyState: 2, videoWidth: 3840, videoHeight: 2160, currentTime: -2, duration: 5,
    });
    assert.deepEqual(frame, {
      dataUrl: 'data:image/png;base64,AAAA',
      mimeType: 'image/png',
      timestamp: 0,
      width: 2048,
      height: 1152,
    });
    assert.deepEqual({ width: canvas.width, height: canvas.height }, { width: 2048, height: 1152 });
  } finally {
    globalThis.document = previousDocument;
  }
});

test('frame capture errors have user-facing English messages', () => {
  assert.match(getFrameCaptureErrorMessage(new FrameCaptureError('tainted-video', 'x')), /cross-origin/i);
  assert.match(getFrameCaptureErrorMessage(new FrameCaptureError('metadata-unavailable', 'x')), /not ready/i);
  assert.match(getFrameCaptureErrorMessage(new FrameCaptureError('empty-frame', 'x')), /empty/i);
  assert.match(getFrameCaptureErrorMessage(new FrameCaptureError('canvas-unavailable', 'x')), /canvas/i);
  assert.match(getFrameCaptureErrorMessage(new FrameCaptureError('unsupported', 'x')), /cannot capture/i);
  assert.equal(getFrameCaptureErrorMessage(new Error('custom failure')), 'custom failure');
  assert.match(getFrameCaptureErrorMessage('nope'), /could not be captured/i);
});

const makeCanvas = () => ({
  width: 0,
  height: 0,
  getContext: () => ({ drawImage() {} }),
  toDataURL: () => 'data:image/png;base64,AAAA',
});

const makeVideo = ({ duration = 5, fail = false, emitEvents = true } = {}) => {
  const listeners = new Map();
  const video = {
    crossOrigin: null,
    muted: false,
    playsInline: false,
    preload: '',
    duration,
    videoWidth: 640,
    videoHeight: 360,
    readyState: 0,
    _time: 0,
    error: null,
    addEventListener(name, fn, options) {
      const entries = listeners.get(name) || [];
      listeners.set(name, [...entries, { fn, once: options?.once }]);
    },
    removeEventListener(name, fn) {
      listeners.set(name, (listeners.get(name) || []).filter(entry => entry.fn !== fn));
    },
    emit(name) {
      const entries = listeners.get(name) || [];
      listeners.delete(name);
      for (const { fn } of entries) fn({ type: name });
    },
    pause() {},
    load() {},
    removeAttribute() { this._src = undefined; },
    get src() { return this._src; },
    set src(value) {
      this._src = value;
      if (!emitEvents) return;
      queueMicrotask(() => {
        if (fail) {
          this.error = { code: 4 };
          this.emit('error');
        } else {
          this.readyState = 2;
          this.emit('loadedmetadata');
        }
      });
    },
    get currentTime() { return this._time; },
    set currentTime(value) {
      this._time = value;
      queueMicrotask(() => {
        this.readyState = 2;
        this.emit('seeked');
      });
    },
  };
  return video;
};

test('cross-origin fallback loads a CORS-annotated element at the requested timestamp', async () => {
  const previousDocument = globalThis.document;
  const video = makeVideo();
  try {
    globalThis.document = {
      createElement: tag => tag === 'video' ? video : makeCanvas(),
    };
    const frame = await captureFrameFromUrl('https://cdn.example/video.mp4#t=0.1', 3.25);
    assert.equal(video.crossOrigin, 'anonymous');
    assert.equal(frame.timestamp, 3.25);
    assert.deepEqual({ width: frame.width, height: frame.height }, { width: 640, height: 360 });
    assert.equal(video.src, undefined, 'the temporary source is released after capture');

    const clamped = await captureFrameFromUrl('https://cdn.example/video.mp4', 99);
    assert.equal(clamped.timestamp, 5);
  } finally {
    globalThis.document = previousDocument;
  }
});

test('cross-origin fallback reports load and CORS failures instead of saving a file', async () => {
  const previousDocument = globalThis.document;
  try {
    globalThis.document = {
      createElement: tag => tag === 'video' ? makeVideo({ fail: true }) : makeCanvas(),
    };
    await assert.rejects(
      captureFrameFromUrl('https://cdn.example/video.mp4', 1),
      error => error instanceof FrameCaptureError && error.code === 'tainted-video',
    );

    globalThis.document = {
      createElement: tag => tag === 'video' ? makeVideo({ emitEvents: false }) : makeCanvas(),
    };
    await assert.rejects(
      captureFrameFromUrl('https://cdn.example/video.mp4', 1, undefined, 10),
      error => error instanceof FrameCaptureError && error.code === 'metadata-unavailable',
    );
  } finally {
    globalThis.document = previousDocument;
  }
});
