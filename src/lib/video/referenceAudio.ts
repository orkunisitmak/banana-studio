import { formatRejectedDuration } from './rejectedDuration';

export const MAX_REFERENCE_AUDIO_BYTES = 15 * 1024 * 1024;

type PcmAudio = Pick<AudioBuffer, 'numberOfChannels' | 'length' | 'sampleRate' | 'getChannelData'>;

/** Encode decoded audio, rather than relabeling compressed bytes as WAV. */
export const encodeReferenceWav = (audio: PcmAudio): Blob => {
  const channels = audio.numberOfChannels;
  const dataSize = audio.length * channels * 2;
  if (44 + dataSize > MAX_REFERENCE_AUDIO_BYTES) {
    throw new Error('Converted reference audio is too large. Maximum is 15MB; use a shorter MP3 or WAV.');
  }
  const bytes = new ArrayBuffer(44 + dataSize);
  const view = new DataView(bytes);
  const text = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
  };
  text(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM, 16-bit little endian.
  view.setUint16(22, channels, true);
  view.setUint32(24, audio.sampleRate, true);
  view.setUint32(28, audio.sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, dataSize, true);
  const channelData = Array.from({ length: channels }, (_, channel) => audio.getChannelData(channel));
  let offset = 44;
  for (let sample = 0; sample < audio.length; sample++) {
    for (const channel of channelData) {
      const value = Math.max(-1, Math.min(1, channel[sample]));
      view.setInt16(offset, Math.round(value * (value < 0 ? 32768 : 32767)), true);
      offset += 2;
    }
  }
  return new Blob([bytes], { type: 'audio/wav' });
};

export const prepareReferenceAudio = async (
  blob: Blob,
  label: string,
  minDuration = 2,
  maxDuration = 30,
): Promise<Blob> => {
  if (!blob.size) throw new Error(`${label} is empty or could not be read. Choose the audio file again.`);
  if (blob.size > MAX_REFERENCE_AUDIO_BYTES) {
    throw new Error(`${label} is too large for video generation. Maximum is 15MB.`);
  }

  // File.type may be empty, generic, or incorrect. Read the container before
  // choosing the upload MIME/extension; never trust a .mp3 filename alone.
  const header = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
  const text = (start: number, end: number) => String.fromCharCode(...header.slice(start, end));
  const isWav = text(0, 4) === 'RIFF' && text(8, 12) === 'WAVE';
  const isMp3 = text(0, 3) === 'ID3' || (header.length >= 4
    && header[0] === 0xff && (header[1] & 0xe0) === 0xe0
    && (header[1] & 0x18) !== 0x08 && (header[1] & 0x06) === 0x02
    && (header[2] & 0xf0) !== 0 && (header[2] & 0xf0) !== 0xf0 && (header[2] & 0x0c) !== 0x0c);
  if (isWav || isMp3) return blob.slice(0, blob.size, isWav ? 'audio/wav' : 'audio/mpeg');

  // M4A/AAC and other browser-readable inputs need actual PCM conversion for
  // Seedance. Offline decoding does not play audio or open an output device.
  let audio: AudioBuffer;
  try {
    const Decoder = globalThis.OfflineAudioContext
      || (globalThis as typeof globalThis & { webkitOfflineAudioContext?: typeof OfflineAudioContext }).webkitOfflineAudioContext;
    if (!Decoder) throw new Error('Audio decoding is unavailable');
    audio = await new Decoder(1, 1, 48000).decodeAudioData(await blob.arrayBuffer());
  } catch {
    throw new Error(`${label} could not be decoded. Choose a valid MP3 or WAV, or export this audio as MP3/WAV and attach it again.`);
  }
  if (!Number.isFinite(audio.duration) || audio.duration < minDuration || audio.duration > maxDuration) {
    throw new Error(`${label} must be ${minDuration}-${maxDuration} seconds.${Number.isFinite(audio.duration) ? ` Current duration is ${formatRejectedDuration(audio.duration, minDuration, maxDuration)}s.` : ''}`);
  }
  return encodeReferenceWav(audio);
};
