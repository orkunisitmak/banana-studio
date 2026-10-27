import { supabase } from './authService';
import { createTaskDeadline, waitForTask } from '../lib/shared/asyncTask';
import type { OpenAIReasoningEffort } from '../lib/prompts/openaiText';
import { selectProvider } from './providerRouting';
import { isCliProvider } from '../lib/providers';

export type TextTaskStage = 'preparing' | 'connecting' | 'generating' | 'finishing';
export interface TextTaskOptions {
  signal?: AbortSignal;
  onStage?: (stage: TextTaskStage) => void;
  model?: string;
  reasoningEffort?: OpenAIReasoningEffort;
  thinkingLevel?: 'LOW' | 'MEDIUM' | 'HIGH';
}

// Re-export the constants we previously pulled in from @google/genai so
// callers can keep using `Modality.IMAGE` and `ThinkingLevel.HIGH` as
// readable string identifiers without bundling the SDK into the client.
export const Modality = {
  MODALITY_UNSPECIFIED: 'MODALITY_UNSPECIFIED',
  TEXT: 'TEXT',
  IMAGE: 'IMAGE',
  AUDIO: 'AUDIO',
} as const;
export type Modality = (typeof Modality)[keyof typeof Modality];

export const ThinkingLevel = {
  THINKING_LEVEL_UNSPECIFIED: 'THINKING_LEVEL_UNSPECIFIED',
  LOW: 'LOW',
  MEDIUM: 'MEDIUM',
  HIGH: 'HIGH',
} as const;
export type ThinkingLevel = (typeof ThinkingLevel)[keyof typeof ThinkingLevel];

export interface GenerateContentRequest {
  model: string;
  contents: unknown;
  config?: unknown;
  reasoningEffort?: OpenAIReasoningEffort;
  /** Match the server's structured output to the requested Brainstorm deliverable. */
  brainstormFormat?: 'wardrobe';
  brainstormCount?: number;
  outputFormat?: 'youtube_analysis';
  /** Set by the router for the desktop subscription (CLI) routes. */
  cliProvider?: 'claude-cli' | 'codex-cli';
  usageContext?: { action: 'enhance' | 'video_enhance' | 'brainstorm' | 'variation'; prompt: string };
}

export interface GenerateContentResponse {
  text: string | null;
  candidates: any[] | null;
  usageMetadata: any;
  promptFeedback?: any;
}

const GEMINI_ENDPOINT = '/api/gemini-generate';
const STATUS_ENDPOINT = '/api/gemini-status';

const getAuthHeaders = async (signal: AbortSignal, onIdentity?: (userId: string | undefined) => void): Promise<Record<string, string>> => {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const auth = createTaskDeadline(15_000, signal, 'Oturum doğrulanamadı. Sayfayı yenileyip yeniden dene.');
  try {
    const { data } = await waitForTask(supabase.auth.getSession(), auth.signal);
    const token = data?.session?.access_token;
    onIdentity?.(data?.session?.user?.id);
    if (token) headers.Authorization = `Bearer ${token}`;
  } catch (error) {
    if (auth.signal.aborted) throw auth.signal.reason;
    // No session — request will fail at the server with a 401.
  } finally { auth.dispose(); }
  return headers;
};

const extractError = async (res: Response): Promise<string> => {
  try {
    const data = await res.json();
    return data?.error || `Request failed with status ${res.status}`;
  } catch {
    return `Request failed with status ${res.status}`;
  }
};

const generateContent = async (
  request: GenerateContentRequest,
  endpoint = GEMINI_ENDPOINT,
  options: TextTaskOptions = {},
): Promise<GenerateContentResponse> => {
  let lastStage: TextTaskStage | undefined;
  const reportStage = (stage: TextTaskStage) => {
    if (lastStage !== stage) { lastStage = stage; options.onStage?.(stage); }
  };
  const task = createTaskDeadline(285_000, options.signal, 'Model yanıt süresi aşıldı. İstek otomatik olarak tekrarlanmadı.');
  // iOS may suspend both timers and stream reads in the background. Enforce
  // the same wall-clock deadline on return, including Enhance (which has no
  // Brainstorm batch owner), without submitting another provider request.
  const checkDeadline = () => task.check();
  const ensureActive = () => { task.check(); task.signal.throwIfAborted(); };
  const pageDocument = typeof document === 'undefined' ? undefined : document;
  const pageWindow = typeof window === 'undefined' ? undefined : window;
  pageDocument?.addEventListener?.('visibilitychange', checkDeadline);
  pageWindow?.addEventListener?.('pageshow', checkDeadline);
  try {
    reportStage('connecting');
    let initiatingUserId: string | undefined;
    const headers = await getAuthHeaders(task.signal, userId => { initiatingUserId = userId; });
    const requireSameSession = async () => {
      const auth = createTaskDeadline(15_000, task.signal, 'Oturum doğrulanamadı. Sayfayı yenileyip yeniden dene.');
      try {
        const { data: { session } } = await waitForTask(supabase.auth.getSession(), auth.signal);
        ensureActive();
        if (session?.user?.id !== initiatingUserId) throw new Error('Oturum değişti. Devam etmek için yeniden giriş yap.');
      } finally { auth.dispose(); }
    };
    headers.Accept = 'application/x-ndjson';
    ensureActive();
    const res = await waitForTask(fetch(endpoint, {
      method: 'POST', headers, body: JSON.stringify(request), signal: task.signal,
    }), task.signal);
    ensureActive();
    if (!res.ok) throw new Error(await waitForTask(extractError(res), task.signal));
    if (res.headers?.get('content-type')?.includes('application/x-ndjson')) {
      if (!res.body) throw new Error('Model bağlantısı kapandı. İstek otomatik olarak tekrarlanmadı.');
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      try {
        while (true) {
          const { value, done } = await waitForTask(reader.read(), task.signal);
          ensureActive();
          buffer += decoder.decode(value, { stream: !done });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';
          if (done && buffer.trim()) lines.push(buffer);
          for (const line of lines) {
            if (!line.trim()) continue;
            const event = JSON.parse(line);
            if (event.type === 'error') throw new Error(event.error);
            if (event.type === 'result') {
              reportStage('finishing');
              await requireSameSession();
              return event.result as GenerateContentResponse;
            }
            if (event.type === 'status' && ['generating', 'finishing'].includes(event.stage)) reportStage(event.stage);
          }
          if (done) throw new Error('Model bağlantısı yanıt tamamlanmadan kapandı. İstek otomatik olarak tekrarlanmadı.');
        }
      } finally { void reader.cancel().catch(() => {}); }
    }
    const result = await waitForTask(res.json(), task.signal) as GenerateContentResponse;
    reportStage('finishing');
    await requireSameSession();
    return result;
  } finally {
    pageDocument?.removeEventListener?.('visibilitychange', checkDeadline);
    pageWindow?.removeEventListener?.('pageshow', checkDeadline);
    task.dispose();
  }
};

/**
 * Drop-in replacement for `new GoogleGenAI({ apiKey })`. Returns an object
 * exposing `models.generateContent(...)` with the same shape the rest of the
 * codebase already consumes — but every call is routed through our Vercel
 * function so the API key never reaches the browser.
 */
const routeTextContent = async (request: GenerateContentRequest, options?: TextTaskOptions) => {
  const provider = await selectProvider(request.model, options?.signal);
  const config = request.config as any;
  const video = (request.contents as any)?.parts?.some((part: any) => part.fileData);
  const normalized = { ...request,
    reasoningEffort: request.reasoningEffort || ({ LOW: 'low', MEDIUM: 'medium', HIGH: 'high' } as const)[config?.thinkingConfig?.thinkingLevel as 'LOW' | 'MEDIUM' | 'HIGH'],
    usageContext: request.usageContext || { action: 'enhance' as const, prompt: video ? '[youtube-video-brief]' : '[text-task]' },
    ...(video ? { outputFormat: 'youtube_analysis' as const } : {}),
  };
  if (isCliProvider(provider)) return generateContent({ ...normalized, cliProvider: provider }, '/api/cli-text-generate', options);
  return generateContent(normalized, provider === 'openrouter' ? '/api/openrouter-text-generate' : provider === 'openai' ? '/api/openai-text-generate' : GEMINI_ENDPOINT, options);
};
export const getGeminiClient = () => ({
  models: {
    generateContent: routeTextContent,
  },
});

/** Legacy export name: both compatible providers use the same normalized
 * text/reference contract and authenticated streaming client. */
export const getOpenAITextClient = () => ({
  models: { generateContent: routeTextContent },
});

export const isGeminiConfigured = async (): Promise<boolean> => {
  try {
    const res = await fetch(STATUS_ENDPOINT, { cache: 'no-store', headers: await getAuthHeaders(new AbortController().signal) });
    if (!res.ok) return false;
    const data = await res.json();
    return Boolean(data?.configured);
  } catch {
    return false;
  }
};
