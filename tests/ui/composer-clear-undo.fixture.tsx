import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { GenerationConfig } from '../../src/types';
import '../../src/styles/index.css';

window.__BANANA_STUDIO_CONFIG__ = { mode: 'local', userId: '00000000-0000-0000-0000-000000000001', sessionId: '00000000-0000-0000-0000-000000000002' };
window.fetch = async input => {
  if (String(input) === '/api/gemini-status') return Response.json({ providers: { openai: true } });
  if (String(input) === '/local/query') return Response.json({ data: [], error: null });
  throw new Error('This synthetic fixture blocks application network requests.');
};
const [{ Controls }, { getPromptEnhancementTarget }] = await Promise.all([
  import('../../src/components/Controls'), import('../../src/types'),
]);
const videoUrl = URL.createObjectURL(new Blob([], { type: 'video/mp4' }));
const audioUrl = URL.createObjectURL(new Blob([], { type: 'audio/wav' }));
const initial: GenerationConfig = {
  mode: 'video', videoModel: 'seedance-2.5', videoOperation: 'generate',
  prompt: 'Enhanced cinematic shot with the source and soundtrack', originalPrompt: 'My original scene brief',
  promptPreparation: { action: 'enhance', model: 'gpt-5.5' },
  referenceImages: [],
  referenceVideos: [{ id: 'source', url: videoUrl, name: 'source.mp4', mimeType: 'video/mp4', duration: 5, width: 1280, height: 720, isContinuation: true, previousPrompt: 'The previous shot' }],
  referenceAudios: [{ id: 'soundtrack', url: audioUrl, name: 'soundtrack.wav', mimeType: 'audio/wav', duration: 5 }],
  aspectRatio: '16:9', resolution: '1K', imageModel: 'gpt-image-2.5-sunburst', count: 1,
  videoAspectRatio: '16:9', videoQuality: '720p', videoDuration: 5, audioEnabled: true, videoPromptExpansionMode: 'balanced',
};
Object.assign(initial, getPromptEnhancementTarget(initial));
const h3Images: GenerationConfig = {
  ...initial, videoModel: 'minimax-h3', h3MaxMode: 'reference_to_video', videoQuality: '768p',
  prompt: 'Üç görselden bir video hazırla', originalPrompt: undefined, promptPreparation: undefined,
  referenceImages: Array.from({ length: 3 }, (_, index) => ({ id: `scene-${index}`, mimeType: 'image/png', width: 1, height: 1,
    data: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j+foAAAAASUVORK5CYII=' })),
  referenceVideos: [], referenceAudios: [], h3MaxOptions: {},
};

function Fixture() {
  const [config, setConfig] = useState(initial);
  return <main className="min-h-screen bg-[#0d1117] p-5 text-white">
    <h1>Composer Clear / Undo regression fixture</h1>
    <p>Synthetic references only. Generation is disabled and application requests are mocked.</p>
    <button onClick={() => setConfig(initial)}>Load prepared video draft</button>{' '}
    <button onClick={() => setConfig({ ...initial, prompt: '', originalPrompt: undefined, promptPreparation: undefined })}>Load media-only draft</button>
    {' '}<button onClick={() => setConfig(h3Images)}>Görselli H3 taslağı yükle</button>
    <pre aria-label="Current draft">{JSON.stringify(config, null, 2)}</pre>
    <Controls config={config} onChange={setConfig} onGenerate={() => { throw new Error('Generation is disabled in this fixture.'); }}
      activeRequests={0} templates={[]} onSaveTemplate={() => {}} onUpdateTemplate={() => {}}
      onDeleteTemplate={() => {}} onSelectTemplate={() => {}} />
  </main>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
