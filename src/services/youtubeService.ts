import { supabase } from './authService';
import { createTaskDeadline, waitForTask } from '../lib/shared/asyncTask';

const YOUTUBE_PROXY_ENDPOINT = '/api/youtube';
const YOUTUBE_STATUS_ENDPOINT = '/api/youtube-status';

// --- Types ---

export interface YouTubeVideo {
  id: string;
  title: string;
  publishedAt: string;
  thumbnailUrl: string;
  viewCount: number;
  durationSeconds: number;
}

export interface YouTubeVideoInfo {
  id: string;
  title: string;
  description: string;
  tags: string[];
  channelTitle: string;
  publishedAt: string;
  thumbnailUrl: string;
  viewCount: number;
  durationSeconds: number;
}

export interface YouTubeChannel {
  id: string;
  title: string;
  thumbnailUrl: string;
  uploadsPlaylistId: string;
}

export type InputType = { kind: 'video'; videoId: string } | { kind: 'channel'; raw: string } | null;

// --- Helpers ---

const parseVideoId = (input: string): string | null => {
  const trimmed = input.trim();
  try {
    const url = new URL(trimmed.startsWith('http') ? trimmed : `https://${trimmed}`);
    const shortHost = url.hostname === 'youtu.be' || url.hostname === 'www.youtu.be';
    const youtubeHost = url.hostname === 'youtube.com' || url.hostname.endsWith('.youtube.com');
    const embedHost = url.hostname === 'youtube-nocookie.com' || url.hostname === 'www.youtube-nocookie.com';
    if (!['http:', 'https:'].includes(url.protocol) || (!shortHost && !youtubeHost && !embedHost)) return null;
    const validId = (value: string | null) => value && /^[a-zA-Z0-9_-]{11}$/.test(value) ? value : null;

    // youtube.com/watch?v=ID
    const vParam = url.searchParams.get('v');
    if (youtubeHost && url.pathname === '/watch' && vParam) return validId(vParam);

    // youtu.be/ID
    if (shortHost) {
      const id = url.pathname.slice(1).split('/')[0];
      return validId(id);
    }

    // youtube.com/shorts/ID  or  youtube.com/live/ID
    const shortMatch = youtubeHost && url.pathname.match(/^\/(shorts|live)\/([a-zA-Z0-9_-]+)(?:\/|$)/);
    if (shortMatch) return validId(shortMatch[2]);

    // youtube.com/embed/ID
    const embedMatch = url.pathname.match(/^\/embed\/([a-zA-Z0-9_-]+)/);
    if (embedMatch) return validId(embedMatch[1]);
  } catch { /* not a URL */ }
  return null;
};

/**
 * Detect whether the user typed a video URL or a channel reference.
 */
export const detectInputType = (input: string): InputType => {
  const videoId = parseVideoId(input);
  if (videoId) return { kind: 'video', videoId };

  const channel = parseChannelInput(input);
  if (channel) return { kind: 'channel', raw: input };

  return null;
};

// --- Helpers ---

const parseChannelInput = (
  input: string
): { type: 'handle' | 'channelId' | 'username'; value: string } | null => {
  const trimmed = input.trim();
  if (!trimmed) return null;

  if (/^@[a-zA-Z0-9_.-]+$/.test(trimmed))
    return { type: 'handle', value: trimmed };
  if (/^[a-zA-Z0-9_.-]+$/.test(trimmed) && !trimmed.includes('.'))
    return { type: 'handle', value: `@${trimmed}` };

  try {
    const url = new URL(trimmed.startsWith('http') ? trimmed : `https://${trimmed}`);
    if (!['http:', 'https:'].includes(url.protocol)
      || !(url.hostname === 'youtube.com' || url.hostname.endsWith('.youtube.com'))) return null;
    const p = url.pathname;

    const handle = p.match(/^\/@([^/]+)/);
    if (handle) return { type: 'handle', value: `@${handle[1]}` };

    const channel = p.match(/^\/channel\/(UC[a-zA-Z0-9_-]+)/);
    if (channel) return { type: 'channelId', value: channel[1] };

    const user = p.match(/^\/(c|user)\/([^/]+)/);
    if (user) return { type: 'username', value: user[2] };

    const custom = p.match(/^\/([a-zA-Z0-9_-]+)\/?$/);
    if (custom && !['watch', 'feed', 'playlist', 'shorts', 'live'].includes(custom[1]))
      return { type: 'handle', value: `@${custom[1]}` };
  } catch {
    if (/^[a-zA-Z0-9_.-]+$/.test(trimmed))
      return { type: 'handle', value: `@${trimmed}` };
  }

  return null;
};

// YouTube writes videos of a day or longer as P#DT#H#M#S (ISO 8601), and live streams as P0D.
const parseDuration = (iso: string): number => {
  const m = iso.match(/^P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/);
  if (!m) return 0;
  return (
    parseInt(m[1] || '0') * 604800 +
    parseInt(m[2] || '0') * 86400 +
    parseInt(m[3] || '0') * 3600 +
    parseInt(m[4] || '0') * 60 +
    parseInt(m[5] || '0')
  );
};

const apiFetch = async (
  endpoint: string,
  params: Record<string, string>,
  options: { signal?: AbortSignal } = {},
): Promise<any> => {
  const task = createTaskDeadline(20_000, options.signal, 'YouTube lookup timed out. Please try again.');
  try {
    task.signal.throwIfAborted();
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    try {
      const { data } = await waitForTask(supabase.auth.getSession(), task.signal);
      const token = data?.session?.access_token;
      if (token) headers.Authorization = `Bearer ${token}`;
    } catch { /* unauthenticated request will be rejected by the server */ }
    task.signal.throwIfAborted();

    const res = await waitForTask(fetch(YOUTUBE_PROXY_ENDPOINT, {
      method: 'POST',
      headers,
      body: JSON.stringify({ endpoint, params }),
      signal: task.signal,
    }), task.signal);

    let data: any;
    try {
      data = await waitForTask(res.json(), task.signal);
    } catch {
      task.signal.throwIfAborted();
      throw new Error(`YouTube proxy returned non-JSON response (${res.status})`);
    }

    if (!res.ok || data?.error) {
      throw new Error(data?.error || `YouTube API error (${res.status})`);
    }
    return data;
  } finally { task.dispose(); }
};

// --- Public API ---

export const isYouTubeConfigured = async (): Promise<boolean> => {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) return false;
    const res = await fetch(YOUTUBE_STATUS_ENDPOINT, { cache: 'no-store', headers: { Authorization: `Bearer ${session.access_token}` } });
    if (!res.ok) return false;
    const data = await res.json();
    return Boolean(data?.configured);
  } catch {
    return false;
  }
};

export const resolveChannel = async (input: string): Promise<YouTubeChannel> => {
  const parsed = parseChannelInput(input);
  if (!parsed) throw new Error('Invalid channel URL or handle');

  let data: any;

  if (parsed.type === 'channelId') {
    data = await apiFetch('channels', { part: 'snippet,contentDetails', id: parsed.value });
  } else if (parsed.type === 'handle') {
    data = await apiFetch('channels', { part: 'snippet,contentDetails', forHandle: parsed.value });
  } else {
    data = await apiFetch('channels', { part: 'snippet,contentDetails', forUsername: parsed.value });
  }

  if (!data.items?.length) {
    // A channel ID is exact: never substitute a search match for it. This also
    // stops the search result's own ID lookup from searching again.
    if (parsed.type === 'channelId') throw new Error('Channel not found');
    // Fallback: search for the channel (costs 100 quota units)
    const search = await apiFetch('search', {
      part: 'snippet',
      q: parsed.value.replace('@', ''),
      type: 'channel',
      maxResults: '1',
    });
    if (!search.items?.length) throw new Error('Channel not found');
    return resolveChannel(`https://youtube.com/channel/${search.items[0].snippet.channelId}`);
  }

  const ch = data.items[0];
  return {
    id: ch.id,
    title: ch.snippet.title,
    thumbnailUrl: ch.snippet.thumbnails?.default?.url || '',
    uploadsPlaylistId: ch.contentDetails?.relatedPlaylists?.uploads || '',
  };
};

/**
 * Fetch full metadata for a single video (title, description, tags, thumbnail).
 * Costs 2 API quota units (1 for videos.list).
 */
export const getVideoInfo = async (videoId: string, options: { signal?: AbortSignal } = {}): Promise<YouTubeVideoInfo> => {
  if (!/^[a-zA-Z0-9_-]{11}$/.test(videoId)) throw new Error('Invalid YouTube video ID');
  const data = await apiFetch('videos', {
    part: 'snippet,contentDetails,statistics',
    id: videoId,
  }, options);

  if (!data.items?.length) throw new Error('Video not found');

  const v = data.items[0];
  return {
    id: v.id,
    title: v.snippet.title,
    description: v.snippet.description || '',
    tags: v.snippet.tags || [],
    channelTitle: v.snippet.channelTitle || '',
    publishedAt: v.snippet.publishedAt,
    thumbnailUrl:
      v.snippet.thumbnails?.maxres?.url ||
      v.snippet.thumbnails?.standard?.url ||
      v.snippet.thumbnails?.high?.url ||
      v.snippet.thumbnails?.medium?.url ||
      '',
    viewCount: parseInt(v.statistics?.viewCount || '0'),
    durationSeconds: parseDuration(v.contentDetails?.duration || ''),
  };
};

const fetchPlaylistPage = async (
  playlistId: string,
  maxResults: number,
  pageToken?: string
): Promise<{ videoIds: string[]; nextPageToken?: string }> => {
  const params: Record<string, string> = {
    part: 'contentDetails',
    playlistId,
    maxResults: String(maxResults),
  };
  if (pageToken) params.pageToken = pageToken;

  const data = await apiFetch('playlistItems', params);
  return {
    videoIds: (data.items || []).map((i: any) => i.contentDetails.videoId),
    nextPageToken: data.nextPageToken,
  };
};

const fetchVideoDetails = async (ids: string[]): Promise<YouTubeVideo[]> => {
  if (!ids.length) return [];
  const videos: YouTubeVideo[] = [];

  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    const data = await apiFetch('videos', {
      part: 'snippet,contentDetails,statistics',
      id: chunk.join(','),
    });

    for (const v of data.items || []) {
      videos.push({
        id: v.id,
        title: v.snippet.title,
        publishedAt: v.snippet.publishedAt,
        thumbnailUrl:
          v.snippet.thumbnails?.maxres?.url ||
          v.snippet.thumbnails?.standard?.url ||
          v.snippet.thumbnails?.high?.url ||
          v.snippet.thumbnails?.medium?.url ||
          '',
        viewCount: parseInt(v.statistics?.viewCount || '0'),
        durationSeconds: parseDuration(v.contentDetails?.duration || ''),
      });
    }
  }

  return videos;
};

/**
 * Top performing long-form videos from the last 365 days, sorted by views.
 * Uses ~9 API quota units (channels already resolved by caller).
 */
export const getTopPerformingVideos = async (
  uploadsPlaylistId: string,
  count: number = 10
): Promise<YouTubeVideo[]> => {
  const cutoff = new Date();
  cutoff.setFullYear(cutoff.getFullYear() - 1);

  let allIds: string[] = [];
  let token: string | undefined;

  for (let page = 0; page < 4 && allIds.length < 200; page++) {
    const { videoIds, nextPageToken } = await fetchPlaylistPage(uploadsPlaylistId, 50, token);
    allIds.push(...videoIds);
    token = nextPageToken;
    if (!token) break;
  }

  const videos = await fetchVideoDetails(allIds);

  return videos
    .filter((v) => v.durationSeconds > 240 && new Date(v.publishedAt) >= cutoff)
    .sort((a, b) => b.viewCount - a.viewCount)
    .slice(0, count);
};

/**
 * Latest long-form videos sorted newest-first (for manual browsing/selection).
 * Fetches enough from the playlist to return `count` videos after filtering out Shorts.
 */
export const getLatestVideos = async (
  uploadsPlaylistId: string,
  count: number = 50
): Promise<YouTubeVideo[]> => {
  const longForm: YouTubeVideo[] = [];
  let token: string | undefined;
  const MAX_PAGES = 10;

  for (let page = 0; page < MAX_PAGES && longForm.length < count; page++) {
    const { videoIds, nextPageToken } = await fetchPlaylistPage(uploadsPlaylistId, 50, token);
    if (videoIds.length === 0) break;

    const details = await fetchVideoDetails(videoIds);
    for (const v of details) {
      if (v.durationSeconds > 240) longForm.push(v);
      if (longForm.length >= count) break;
    }

    token = nextPageToken;
    if (!token) break;
  }

  return longForm;
};

export const downloadThumbnail = async (url: string, options: { signal?: AbortSignal } = {}): Promise<string> => {
  const task = createTaskDeadline(20_000, options.signal, 'Thumbnail download timed out. Please try again.');
  try {
    task.signal.throwIfAborted();
    // Try fetch first (works when CORS headers are present)
    try {
      const res = await waitForTask(fetch(url, { signal: task.signal }), task.signal);
      if (!res.ok) throw new Error(`Thumbnail download failed (${res.status})`);
      const blob = await waitForTask(res.blob(), task.signal);
      if (!blob.size || !/^image\/(?:jpeg|png|webp)$/i.test(blob.type)) throw new Error('Thumbnail response was not an image');
      return await waitForTask(new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        const abort = () => reader.abort();
        const cleanup = () => task.signal.removeEventListener('abort', abort);
        task.signal.addEventListener('abort', abort, { once: true });
        reader.onloadend = cleanup;
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.onabort = () => reject(task.signal.reason || new DOMException('Cancelled', 'AbortError'));
        reader.readAsDataURL(blob);
      }), task.signal);
    } catch {
      task.signal.throwIfAborted();
      // Fallback: img + canvas
      return await waitForTask(new Promise<string>((resolve, reject) => {
        const img = new Image();
        const cleanup = () => {
          task.signal.removeEventListener('abort', abort);
          img.onload = null;
          img.onerror = null;
        };
        const abort = () => { cleanup(); img.src = ''; reject(task.signal.reason); };
        task.signal.addEventListener('abort', abort, { once: true });
        img.crossOrigin = 'anonymous';
        img.onload = () => {
          cleanup();
          const c = document.createElement('canvas');
          c.width = img.naturalWidth;
          c.height = img.naturalHeight;
          const ctx = c.getContext('2d');
          if (!ctx) { reject(new Error('Canvas failed')); return; }
          ctx.drawImage(img, 0, 0);
          try { resolve(c.toDataURL('image/jpeg', 0.92)); }
          catch { reject(new Error('CORS blocked thumbnail download')); }
        };
        img.onerror = () => { cleanup(); reject(new Error('Failed to load thumbnail')); };
        img.src = url;
      }), task.signal);
    }
  } finally { task.dispose(); }
};

// --- Formatters ---

export const formatViewCount = (n: number): string => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
};

export const formatDuration = (seconds: number): string => {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0)
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
};
