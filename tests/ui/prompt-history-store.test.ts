import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearPromptHistory,
  loadPromptHistory,
  recordPromptHistory,
} from '../../src/lib/prompts/promptHistoryStore';
import type { GenerationConfig } from '../../src/types';

const config = (prompt: string): GenerationConfig => ({
  prompt,
  count: 1,
  aspectRatio: '1:1',
  resolution: '1K',
  imageModel: 'gemini-3-pro-image-preview',
  referenceImages: [],
  referenceVideos: [],
  referenceAudios: [],
  mode: 'image',
  videoModel: 'seedance-2.5',
  videoOperation: 'generate',
  videoAspectRatio: '16:9',
  videoQuality: '720p',
  videoDuration: 5,
  audioEnabled: true,
  videoPromptExpansionMode: 'balanced',
});

describe('prompt history store', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('records prompts newest-first and removes duplicates', () => {
    recordPromptHistory('user-1', config('First'));
    const entries = recordPromptHistory('user-1', config('Second'));
    expect(entries.map(entry => entry.prompt)).toEqual(['Second', 'First']);

    const deduped = recordPromptHistory('user-1', config('First'));
    expect(deduped.map(entry => entry.prompt)).toEqual(['First', 'Second']);
    expect(deduped).toHaveLength(2);
  });

  it('caps history and isolates users', () => {
    for (let index = 0; index < 35; index++) recordPromptHistory('user-1', config(`Prompt ${index}`));
    expect(loadPromptHistory('user-1')).toHaveLength(30);
    expect(loadPromptHistory('user-2')).toEqual([]);
  });

  it('clears only the requested history', () => {
    recordPromptHistory('user-1', config('Keep me'));
    clearPromptHistory('user-1');
    expect(loadPromptHistory('user-1')).toEqual([]);
  });
});
