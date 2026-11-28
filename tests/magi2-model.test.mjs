import assert from 'node:assert/strict';
import test from 'node:test';
import { buildMagi2Input, MAGI2_MODEL } from '../src/lib/video/magi2.ts';

const text = { videoModel: MAGI2_MODEL, mode: 'text_only', prompt: 'Slow pan.' };
const first = 'https://media.example.com/first.png', last = 'https://media.example.com/last.jpg';
const video = 'https://media.example.com/ref.mov', audio = 'https://media.example.com/ref.wav';
const image = { ...text, mode: 'image_to_video', imageUrls: [first] };
const ref = { ...text, mode: 'reference_to_video' };
const common = { prompt: text.prompt, duration: 5, quality: '1080p', generate_audio: true };

test('MAGI-2 emits only each endpoint’s parameters and keeps explicit audio=false', () => {
  assert.deepEqual(buildMagi2Input(text), { ...common, model: 'magi-2-text-to-video', aspect_ratio: '16:9' });
  assert.deepEqual(buildMagi2Input({ ...text, aspectRatio: '21:9', duration: 4, generateAudio: false }), {
    ...common, model: 'magi-2-text-to-video', aspect_ratio: '21:9', duration: 4, generate_audio: false,
  });
  assert.deepEqual(buildMagi2Input(image), { ...common, model: 'magi-2-image-to-video', image_urls: [first], aspect_ratio: 'auto' });
  assert.equal(buildMagi2Input({ ...image, aspectRatio: 'adaptive' }).aspect_ratio, 'auto');
  assert.deepEqual(buildMagi2Input({ ...image, imageUrls: [first, last], aspectRatio: '9:16' }), {
    ...common, model: 'magi-2-image-to-video', image_urls: [first, last], aspect_ratio: '9:16',
  });
  assert.deepEqual(buildMagi2Input({ ...ref, audioUrls: [audio], audioDurations: [2.1] }), {
    ...common, model: 'magi-2-reference-to-video', aspect_ratio: '16:9', audio_urls: [audio],
  });
  const images = Array(10).fill(first), videos = Array(5).fill(video), audios = Array(5).fill(audio);
  assert.deepEqual(buildMagi2Input({ ...ref, duration: 30, aspectRatio: '21:9', generationId: 'g1',
    imageUrls: images, videoUrls: videos, videoDurations: Array(5).fill(6), audioUrls: audios, audioDurations: Array(5).fill(6),
  }), { ...common, duration: 30, aspect_ratio: '21:9', model: 'magi-2-reference-to-video', image_urls: images, video_urls: videos, audio_urls: audios });
});

test('MAGI-2 counts Unicode code points and rejects invalid or cross-route fields before submission', () => {
  const prompt = '\u{1F3AC}'.repeat(15000);
  assert.equal(buildMagi2Input({ ...text, prompt }).prompt, prompt);
  for (const body of [
    { ...text, prompt: `${prompt}!` }, { ...text, prompt: '\n ' }, { ...text, mode: 'video_edit' },
    ...[3, 31, 4.1, '5', null].map(duration => ({ ...text, duration })),
    { ...text, quality: '720p' }, { ...text, generateAudio: 'false' }, { ...text, generationId: {} },
    { ...text, imageUrls: [] }, { ...text, aspectRatio: 'adaptive' }, { ...ref, imageUrls: [first], aspectRatio: 'auto' },
    { ...image, aspectRatio: '21:9' }, { ...image, imageUrls: [] }, { ...image, imageUrls: [first, last, last] }, { ...image, videoUrls: [] },
    ref, { ...ref, imageUrls: Array(11).fill(first) }, { ...ref, videoUrls: Array(6).fill(video), videoDurations: Array(6).fill(2) },
    { ...ref, audioUrls: Array(6).fill(audio), audioDurations: Array(6).fill(2) }, { ...ref, audioUrls: [audio] },
    ...[[1.99], [30.01], ['2'], [2, 3], [NaN]].map(audioDurations => ({ ...ref, audioUrls: [audio], audioDurations })),
    { ...ref, videoUrls: [video, video], videoDurations: [15, 15.1] }, { ...ref, audioUrls: [audio, audio], audioDurations: [15.1, 15] },
    { ...text, callbackUrl: 'https://example.com/hook' }, { ...text, callback_url: 'https://example.com/hook' }, { ...text, content_filter: false },
  ]) assert.throws(() => buildMagi2Input(body));
});

test('MAGI-2 rejects insecure, credentialed and nonpublic media destinations', () => {
  for (const url of ['http://media.example.com/ref.png', 'data:image/png;base64,AAAA', 'blob:local', 'https://user:pass@example.com/a',
    'https://localhost/a', 'https://app.localhost./a', 'https://router.home.arpa/a', 'https://metadata.google.internal/a', 'https://internalhost/a',
    'https://192.168.1.4/a', 'https://172.31.255.255/a', 'https://169.254.169.254/a', 'https://0x7f000001/a', 'https://10.0.0.1/a',
    'https://[::ffff:127.0.0.1]/a', 'https://[::1]/a', 'https://[fc01::1]/a', 'https://[fe80::1]/a']) {
    assert.throws(() => buildMagi2Input({ ...image, imageUrls: [url] }), /public HTTPS/, url);
  }
  for (const url of [first, 'https://1.1.1.1/a', 'https://[2606:4700:4700::1111]/a']) {
    assert.deepEqual(buildMagi2Input({ ...image, imageUrls: [url] }).image_urls, [url]);
  }
});
