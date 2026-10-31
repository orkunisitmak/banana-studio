import React from 'react';
import { createRoot } from 'react-dom/client';
import '../../src/styles/index.css';

// Runs the real App, Controls, gallery, text client and durable image client.
// All application HTTP is synthetic. This never calls a provider or local server.
const userId = '00000000-0000-0000-0000-000000000071';
window.__BANANA_STUDIO_CONFIG__ = { mode: 'local', userId, sessionId: '00000000-0000-0000-0000-000000000072' };
const storageSlot = 'banana-staged-ui-fixture-v1';
const saved = JSON.parse(sessionStorage.getItem(storageSlot) || '{}');
const f = {
  rows: saved.rows || [] as any[], requests: saved.requests || [] as any[], textRequests: saved.textRequests || 0,
  holdText: false, textWaiters: [] as (() => void)[], failNext: false, loseNextAcknowledgement: false,
};
const persist = () => sessionStorage.setItem(storageSlot, JSON.stringify({ rows: f.rows, requests: f.requests, textRequests: f.textRequests }));
const pixels = () => {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 320;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#243a53'; ctx.fillRect(0, 0, 320, 320);
  ctx.fillStyle = '#f7bd61'; ctx.fillRect(120, 78, 80, 160);
  ctx.fillStyle = '#15283d'; ctx.fillRect(132, 61, 56, 22);
  ctx.fillStyle = '#fff'; ctx.font = '18px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('Sentetik ilk görsel', 160, 282);
  return canvas.toDataURL('image/png');
};
const response = (data: unknown) => Response.json({ data, error: null });
window.fetch = async (input, init) => {
  const path = new URL(input instanceof Request ? input.url : String(input), location.origin).pathname;
  const body = init?.body ? JSON.parse(String(init.body)) : {};
  if (path === '/api/gemini-status') return Response.json({ providers: { openai: true, openrouter: true, gemini: true, fal: true } });
  if (path === '/api/openai-text-generate') {
    f.textRequests++; persist();
    const result = () => Response.json({ text: JSON.stringify(Array.from({ length: body.brainstormCount || 5 }, (_, index) =>
      `A synthetic studio product photograph, concept ${index + 1}, with a distinct camera angle and soft side lighting.`)), candidates: [], usageMetadata: {} });
    if (f.holdText) return new Promise<Response>(resolve => f.textWaiters.push(() => resolve(result())));
    return result();
  }
  if (path === '/api/openai-image-enqueue') {
    if (f.requests.some((request: any) => request.id === body.id)) throw new Error('Duplicate synthetic enqueue ID');
    f.requests.push(body);
    f.rows.push({ id: body.id, user_id: userId, type: 'image', status: 'pending', created_at: Date.now(), url: '',
      prompt: body.displayPrompt, aspect_ratio: body.aspectRatio, resolution: body.resolution, image_model: body.model,
      reference_images: body.referenceImages, folder_id: body.folderId,
      metadata: { originalPrompt: body.originalPrompt, promptPreparation: body.promptPreparation, imageQueue: { version: 1, queuedAt: Date.now() },
        generationProvider: body.provider, imagePromptCategory: body.imagePromptCategory } });
    persist();
    if (f.loseNextAcknowledgement) { f.loseNextAcknowledgement = false; throw new TypeError('Synthetic acknowledgement lost after acceptance'); }
    return Response.json({ id: body.id, durable: true }, { status: 202 });
  }
  if (path === '/local/query') {
    if (body.rpc === 'get_provider_preferences') return response({ 'gpt-6.1-sol': 'openai' });
    if (body.rpc === 'get_text_model_preferences') return response({ model: 'gpt-6.1-sol', reasoningEffort: 'medium', thinkingLevel: 'HIGH', source: 'personal', revision: 1, canSaveAll: true });
    if (body.rpc) return response([]);
    if (body.storage === 'stat') return response(body.paths.map(() => ({ exists: true })));
    if (body.storage) return response([]);
    let rows: any[] = body.table === 'authorized_emails' ? [{ email: 'local@example.invalid', is_active: true }]
      : body.table === 'profiles' ? [{ id: userId, role: 'user', full_name: 'Sentetik çalışma alanı' }]
      : body.table === 'generations' ? f.rows : [];
    const matches = (row: any) => (body.filters || []).every((filter: any) => {
      const value = row[filter.column];
      if (filter.operator === 'eq') return value === filter.value;
      if (filter.operator === 'neq') return value !== filter.value;
      if (filter.operator === 'in') return filter.value.includes(value);
      if (filter.operator === 'is') return filter.value === null ? value == null : value === filter.value;
      return true;
    });
    rows = rows.filter(matches);
    if (body.table === 'generations' && body.operation === 'delete') { f.rows = f.rows.filter((row: any) => !matches(row)); persist(); }
    if (body.table === 'generations' && body.operation === 'update') { rows.forEach(row => Object.assign(row, body.value)); persist(); }
    if (body.range) rows = rows.slice(body.range[0], body.range[1] + 1);
    if (body.limit) rows = rows.slice(0, body.limit);
    return Response.json({ data: body.head ? null : body.single ? rows[0] || null : rows, error: null, count: rows.length });
  }
  throw new Error(`The synthetic fixture blocks application request ${path}`);
};
const status = document.createElement('aside');
status.setAttribute('aria-label', 'Sentetik test kontrolleri');
status.style.cssText = 'position:fixed;top:4px;left:50%;transform:translateX(-50%);z-index:250;padding:6px 10px;background:#243a53;color:white;font:11px sans-serif;border-radius:8px;max-width:90vw;display:flex;gap:10px;align-items:center;flex-wrap:wrap';
const controls: [string, () => void][] = [
  ['Bekleyen görselleri tamamla', () => {
    for (const row of f.rows.filter((value: any) => value.status === 'pending')) {
      row.status = f.failNext ? 'failed' : 'completed'; row.url = f.failNext ? '' : pixels(); row.metadata.error = f.failNext ? 'Synthetic sample failure' : undefined;
    }
    f.failNext = false; persist();
  }],
  ['İlk görseli başarısız yap', () => { f.failNext = true; controls[0][1](); }],
  ['Fikir yanıtını beklet', () => { f.holdText = true; }],
  ['Bekletilen fikirleri tamamla', () => { f.holdText = false; f.textWaiters.splice(0).forEach(resolve => resolve()); }],
  ['Sonraki kabul yanıtını kaybet', () => { f.loseNextAcknowledgement = true; }],
];
for (const [label, run] of controls) { const button = document.createElement('button'); button.textContent = label; button.onclick = run; status.append(button); }
const count = document.createElement('output'); count.setAttribute('aria-label', 'Sentetik gönderim sayısı'); status.append(count);
setInterval(() => { count.textContent = `${f.requests.length} görsel isteği / ${f.textRequests} metin isteği`; }, 100);
document.body.append(status);
(window as any).__stagedFixture = f;
const { default: App } = await import('../../src/App');
createRoot(document.getElementById('root')!).render(<App />);
