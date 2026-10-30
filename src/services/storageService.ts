import { isLocalWorkspace } from '../lib/config/runtimeConfig';
import { withoutLegacyMask } from '../lib/references/referenceImages';
import { normalizePromptPreparation } from '../lib/prompts/promptPreparation';
import { createTaskDeadline, waitForTask } from '../lib/shared/asyncTask';
import { GeneratedMedia, Template, Folder, SavedReferenceImage, SavedPerson, SavedPersonSummary, ReferenceVideo, ReferenceAudio, DEFAULT_IMAGE_MODEL, DEFAULT_VIDEO_MODEL, VideoModelId, VideoOperation, VideoQuality, estimateVideoCost, normalizeYouTubeSource } from '../types';
import { isAuthSessionMissingError } from '@supabase/supabase-js';
import { supabase, getCurrentUserId, SUPABASE_URL } from './authService';
import { retryTransientRead } from '../lib/shared/transientRead';
import { signMediaUrl } from '../lib/references/mediaAccess';
import { Upload } from 'tus-js-client';
import { MAX_VIDEO_UPLOAD_BYTES, MAX_VIDEO_UPLOAD_MB } from '../lib/references/mediaUploadLimits';
import { normalizeH3MaxMode, H3_MAX_ENDPOINTS } from '../lib/video/h3Max';
import { estimateH3MaxCost } from '../lib/video/h3MaxPricing';

const DB_NAME = 'NanoGenDB';
const STORE_NAME = 'images';
const TEMPLATE_STORE_NAME = 'templates';
const FOLDER_STORE_NAME = 'folders';
const REF_GALLERY_STORE_NAME = 'referenceGallery';
const DB_VERSION = 5;
const MEDIA_BUCKET_NAME = 'media';
const ORIGINAL_EXTENSION = 'png';
const THUMBNAIL_EXTENSION = 'png';
const INITIAL_GENERATIONS_PAGE_SIZE = 48;
const BACKGROUND_GENERATIONS_PAGE_SIZE = 250;
const PENDING_DELETIONS_KEY = 'nanogen_pending_deletions';

const getOriginalStoragePath = (id: string): string => `${id}.${ORIGINAL_EXTENSION}`;
const getThumbnailStoragePath = (id: string): string => `${id}_thumb.${THUMBNAIL_EXTENSION}`;

const MEDIA_URL_TTL_SECONDS = 15 * 60;
const PROVIDER_URL_TTL_SECONDS = 60 * 60;
const signedMediaUrls = new Map<string, { url: string; expiresAt: number }>();
// Keyed by the verified owner and reused only while the saved version matches.
const savedPersonCovers = new Map<string, { updatedAt: number; cover: string }>();
let mediaSessionUserId: string | null = null;
const cacheConnections = new Set<IDBDatabase>();
// One shared connection per account database. Opening a new connection for every
// read left each one open until sign-out, so batch reads piled up connections.
const sharedConnections = new WeakMap<IDBFactory, Map<string, Promise<IDBDatabase>>>();
const localMediaObjectUrls = new Set<string>();
const createLocalMediaObjectUrl = (blob: Blob): string => {
  const url = URL.createObjectURL(blob);
  localMediaObjectUrls.add(url);
  return url;
};

const getStorageReferenceUrl = (path: string): string =>
  `${SUPABASE_URL}/storage/v1/object/authenticated/${MEDIA_BUCKET_NAME}/${path.split('/').map(encodeURIComponent).join('/')}`;

// These URLs exist only in memory. Permanent rows retain object paths, never bearer tokens.
const getSignedMediaUrl = (path: string | null | undefined): string | undefined => {
  if (!path) return undefined;
  const cached = signedMediaUrls.get(path);
  return cached && cached.expiresAt > Date.now() + 5 * 60_000 ? cached.url : undefined;
};

const bindMediaSession = async (): Promise<string | null> => {
  const userId = supabase ? await getCurrentUserId() : null;
  if (mediaSessionUserId !== userId) signedMediaUrls.clear();
  mediaSessionUserId = userId;
  return userId;
};

const signMediaPaths = async (paths: Array<string | null | undefined>): Promise<void> => {
  if (!supabase || !await bindMediaSession()) return;
  const missing = Array.from(new Set(paths.filter((path): path is string => !!path && !getSignedMediaUrl(path))));
  for (let offset = 0; offset < missing.length; offset += 100) {
    const userId = mediaSessionUserId;
    const { data, error } = await supabase.storage.from(MEDIA_BUCKET_NAME)
      .createSignedUrls(missing.slice(offset, offset + 100), MEDIA_URL_TTL_SECONDS);
    if (error) throw new Error('Private media access could not be authorized.');
    if (mediaSessionUserId !== userId) return;
    for (const entry of data || []) {
      if (entry.path && entry.signedUrl && !entry.error) {
        signedMediaUrls.set(entry.path, { url: entry.signedUrl, expiresAt: Date.now() + MEDIA_URL_TTL_SECONDS * 1000 });
      }
    }
  }
};

const createMediaAccessUrl = async (path: string, forProvider = false): Promise<string | undefined> => {
  if (!supabase || !await bindMediaSession()) return undefined;
  const userId = mediaSessionUserId;
  const url = await signMediaUrl(supabase.storage.from(MEDIA_BUCKET_NAME), path,
    forProvider ? PROVIDER_URL_TTL_SECONDS : MEDIA_URL_TTL_SECONDS);
  if (mediaSessionUserId !== userId) return undefined;
  if (!forProvider) signedMediaUrls.set(path, { url, expiresAt: Date.now() + MEDIA_URL_TTL_SECONDS * 1000 });
  return url;
};

const isPublicHttpUrl = (url: unknown): url is string => {
  return typeof url === 'string' && /^https?:\/\//i.test(url);
};

const sanitizePublicMediaRefs = <T extends { url?: string }>(refs: T[] | undefined | null): T[] => {
  return Array.isArray(refs) ? refs.filter(ref => isPublicHttpUrl(ref?.url)) : [];
};

const resolveVideoModel = (value: unknown): VideoModelId => {
  if (value === 'seedance-2.0' || value === 'seedance2') return 'seedance-2.0';
  if (value === 'seedance-2.5' || value === 'seedance2.5') return 'seedance-2.5';
  if (value === 'minimax-h3' || value === 'minimax/h3') return 'minimax-h3';
  return DEFAULT_VIDEO_MODEL;
};

const resolveVideoOperation = (value: unknown): VideoOperation => {
  if (value === 'reference_edit' || value === 'edit' || value === 'extend') return value;
  return 'generate';
};

const getStorageExtension = (mimeType: string, fallback = 'bin'): string => {
  if (mimeType.includes('audio/mp4') || mimeType.includes('m4a')) return 'm4a';
  if (mimeType.includes('aac')) return 'aac';
  if (mimeType.includes('ogg')) return 'ogg';
  if (mimeType.includes('webm')) return 'webm';
  if (mimeType.includes('gif')) return 'gif';
  if (mimeType.includes('mp4')) return 'mp4';
  if (mimeType.includes('quicktime') || mimeType.includes('mov')) return 'mov';
  if (mimeType.includes('mpeg')) return 'mp3';
  if (mimeType.includes('wav')) return 'wav';
  if (mimeType.includes('png')) return 'png';
  if (mimeType.includes('webp')) return 'webp';
  if (mimeType.includes('jpeg') || mimeType.includes('jpg')) return 'jpg';
  return fallback;
};

export const uploadBlobToPublicUrl = async (
  blob: Blob,
  mimeType?: string,
  prefix = 'asset',
  fallbackExtension = 'bin',
  options?: { expectedUserId?: string; onUploadPath?: (path: string) => void },
): Promise<string | null> => {
  if (!supabase) return null;
  try {
    const contentType = mimeType || blob.type || 'application/octet-stream';
    const ext = getStorageExtension(contentType, fallbackExtension);
    const userId = await bindMediaSession();
    if (!userId || (options?.expectedUserId && userId !== options.expectedUserId)) return null;
    const safePrefix = prefix.replace(/[^a-zA-Z0-9_-]/g, '_');
    const path = `${userId}/${safePrefix}_${Date.now()}_${Math.random().toString(36).substr(2, 6)}.${ext}`;

    // Record the attempted path before I/O: an upload or signing error can
    // still leave bytes in storage that the caller needs to roll back.
    options?.onUploadPath?.(path);
    const { error } = await supabase.storage.from(MEDIA_BUCKET_NAME).upload(path, blob, {
      contentType,
      cacheControl: '0',
      upsert: true,
    });

    if (error) {
      console.warn('Upload blob failed:', error.message);
      return null;
    }

    return await createMediaAccessUrl(path, true) || null;
  } catch (e: any) {
    console.warn('uploadBlobToPublicUrl error:', e.message);
    return null;
  }
};

export const uploadVideoBlobToPublicUrl = async (
  blob: Blob,
  mimeType?: string,
  prefix = 'vref_video',
  fallbackExtension = 'mp4',
): Promise<string | null> => {
  if (isLocalWorkspace()) return uploadBlobToPublicUrl(blob, mimeType, prefix, fallbackExtension);
  if (blob.size > MAX_VIDEO_UPLOAD_BYTES) {
    throw new Error(`Video is larger than the ${MAX_VIDEO_UPLOAD_MB} MB limit.`);
  }
  if (!supabase) return null;

  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) {
      console.warn('Resumable video upload failed: no authenticated session');
      return null;
    }

    const contentType = mimeType || blob.type || 'video/mp4';
    const ext = getStorageExtension(contentType, fallbackExtension);
    const userId = await bindMediaSession();
    if (!userId) return null;
    const safePrefix = prefix.replace(/[^a-zA-Z0-9_-]/g, '_');
    const path = `${userId}/${safePrefix}_${Date.now()}_${Math.random().toString(36).substr(2, 6)}.${ext}`;
    const projectId = new URL(SUPABASE_URL).hostname.split('.')[0];
    if (!projectId) return null;

    return await new Promise<string | null>((resolve) => {
      let settled = false;
      const finish = (result: string | null) => {
        if (settled) return;
        settled = true;
        resolve(result);
      };

      const upload = new Upload(blob, {
        endpoint: `https://${projectId}.storage.supabase.co/storage/v1/upload/resumable`,
        retryDelays: [0, 3_000, 5_000, 10_000, 20_000],
        headers: {
          authorization: `Bearer ${session.access_token}`,
        },
        uploadDataDuringCreation: true,
        // A resumed upload must never reuse another account's upload URL.
        fingerprint: async () => `media:${userId}:${path}`,
        removeFingerprintOnSuccess: true,
        chunkSize: 6 * 1024 * 1024,
        metadata: {
          bucketName: MEDIA_BUCKET_NAME,
          objectName: path,
          contentType,
          cacheControl: '0',
        },
        onError: (error) => {
          console.warn('Resumable video upload failed:', error.message);
          finish(null);
        },
        onSuccess: () => {
          void createMediaAccessUrl(path, true).then(url => finish(url || null)).catch(() => finish(null));
        },
      });

      upload.findPreviousUploads()
        .then(previousUploads => {
          if (previousUploads.length > 0) {
            upload.resumeFromPreviousUpload(previousUploads[0]);
          }
          upload.start();
        })
        .catch(error => {
          console.warn('Could not inspect resumable video uploads; starting a new upload:', error);
          upload.start();
        });
    });
  } catch (error: any) {
    console.warn('uploadVideoBlobToPublicUrl error:', error?.message || error);
    return null;
  }
};

export const uploadBase64ToPublicUrl = async (base64Data: string, mimeType: string, prefix = 'ref'): Promise<string | null> => {
  if (!supabase) return null;
  try {
    let raw = base64Data;
    if (raw.includes('base64,')) raw = raw.split('base64,')[1];
    const byteChars = atob(raw);
    const byteArray = new Uint8Array(byteChars.length);
    for (let i = 0; i < byteChars.length; i++) byteArray[i] = byteChars.charCodeAt(i);
    const blob = new Blob([byteArray], { type: mimeType });

    return uploadBlobToPublicUrl(blob, mimeType, prefix, 'jpg');
  } catch (e: any) {
    console.warn('uploadBase64ToPublicUrl error:', e.message);
    return null;
  }
};

const extractStoragePathFromUrl = (url: string | null | undefined): string | undefined => {
  if (!url || typeof url !== 'string') return undefined;

  try {
    const parsed = new URL(url);
    if (typeof SUPABASE_URL !== 'string' || parsed.origin !== new URL(SUPABASE_URL).origin) return undefined;
    const match = parsed.pathname.match(/^\/storage\/v1\/(?:object|render\/image)\/(?:public|sign|authenticated)\/media\/(.+)$/);
    if (!match) return undefined;
    const path = decodeURIComponent(match[1]);
    return path.split('/').some(part => !part || part === '.' || part === '..') ? undefined : path;
  } catch {
    return undefined;
  }
};

const persistMediaReference = (url: string | undefined): string | undefined => {
  const path = extractStoragePathFromUrl(url);
  return path ? getStorageReferenceUrl(path) : url;
};

const resolveMediaReference = (url: string | undefined): string | undefined => {
  const path = extractStoragePathFromUrl(url);
  return path ? getSignedMediaUrl(path) : url;
};

/** Refresh a selected gallery/reference asset immediately before provider submission. */
export const refreshMediaAccessUrl = async (url: string, forProvider = true): Promise<string> => {
  const path = extractStoragePathFromUrl(url);
  if (!path) return url;
  const signedUrl = await createMediaAccessUrl(path, forProvider);
  if (!signedUrl) throw new Error('Private reference media access could not be authorized.');
  return signedUrl;
};

const hydrateMediaRows = async (rows: any[]): Promise<void> => {
  const paths: Array<string | undefined> = [];
  for (const row of rows) {
    paths.push(row.storage_path || extractStoragePathFromUrl(row.url));
    paths.push(row.thumbnail_path || extractStoragePathFromUrl(row.thumbnail_url)
      || (row.type !== 'video' ? deriveLegacyThumbnailPath(row.url, row.storage_path) : undefined));
    for (const ref of row.reference_images || []) {
      paths.push(extractStoragePathFromUrl(ref.data));
    }
    for (const ref of [...(row.metadata?.referenceVideos || []), ...(row.metadata?.referenceAudios || [])]) {
      paths.push(extractStoragePathFromUrl(ref.url));
    }
  }
  await signMediaPaths(paths);
};

/** Session transitions remove bearer URLs and caches tied to the previous account. */
export const clearLocalMediaCache = async (previousUserId?: string): Promise<void> => {
  signedMediaUrls.clear();
  savedPersonCovers.clear();
  for (const url of localMediaObjectUrls) URL.revokeObjectURL(url);
  localMediaObjectUrls.clear();
  mediaSessionUserId = null;
  for (const db of cacheConnections) db.close();
  cacheConnections.clear();
  if (typeof indexedDB !== 'undefined') sharedConnections.get(indexedDB)?.clear();
  try {
    localStorage.removeItem(PENDING_DELETIONS_KEY);
    if (previousUserId) localStorage.removeItem(`${PENDING_DELETIONS_KEY}:${previousUserId}`);
  } catch { /* Storage may be disabled by the browser. */ }
  // Never import the old shared DB: it has no trustworthy ownership metadata.
  if (typeof indexedDB === 'undefined') return;
  for (const name of [DB_NAME, ...(previousUserId ? [`${DB_NAME}:${previousUserId}`] : [])]) {
    await new Promise<void>(resolve => {
      const request = indexedDB.deleteDatabase(name);
      request.onsuccess = request.onerror = request.onblocked = () => resolve();
    });
  }
};

const deriveLegacyThumbnailPath = (url: string | null | undefined, storagePath?: string | null): string | undefined => {
  const candidatePath = storagePath || extractStoragePathFromUrl(url);
  if (!candidatePath) return undefined;

  if (candidatePath.includes('_thumb.')) return candidatePath;
  return candidatePath.replace(/\.[^.]+$/, `._legacy_placeholder`).replace('._legacy_placeholder', `_thumb.${THUMBNAIL_EXTENSION}`);
};

const deriveLegacyThumbnailUrl = (url: string | null | undefined, storagePath?: string | null): string | undefined => {
  const legacyThumbPath = deriveLegacyThumbnailPath(url, storagePath);
  return getSignedMediaUrl(legacyThumbPath);
};

const resolveOriginalUrl = (row: any): string => {
  const path = row.storage_path || extractStoragePathFromUrl(row.url);
  return path ? getSignedMediaUrl(path) || '' : row.url || '';
};

const resolveThumbnailPath = (row: any): string | undefined => {
  return row.thumbnail_path || deriveLegacyThumbnailPath(row.url, row.storage_path);
};

const resolveThumbnailUrl = (row: any): string | undefined => {
  const path = row.thumbnail_path || extractStoragePathFromUrl(row.thumbnail_url);
  if (path) return getSignedMediaUrl(path);
  if (row.thumbnail_url) return row.thumbnail_url;
  return deriveLegacyThumbnailUrl(row.url, row.storage_path);
};

const resolveVideoThumbnailPath = (row: any): string | undefined => {
  return typeof row.thumbnail_path === 'string' && row.thumbnail_path.length > 0
    ? row.thumbnail_path
    : undefined;
};

const resolveVideoThumbnailUrl = (row: any): string | undefined => {
  const path = resolveVideoThumbnailPath(row) || extractStoragePathFromUrl(row.thumbnail_url);
  return path ? getSignedMediaUrl(path) : row.thumbnail_url || undefined;
};

const isLocalOnlyMedia = (media: GeneratedMedia): boolean => {
  if (media.syncStatus === 'local-only') return true;
  return media.url.startsWith('data:') || media.url.startsWith('blob:');
};

// --- Pending Deletions Queue ---
// When a DB delete fails, we queue the ID so it's hidden from view and retried later.

const getPendingDeletions = (): Set<string> => {
  try {
    if (!mediaSessionUserId) return new Set();
    const stored = localStorage.getItem(`${PENDING_DELETIONS_KEY}:${mediaSessionUserId}`);
    return stored ? new Set(JSON.parse(stored)) : new Set();
  } catch {
    return new Set();
  }
};

const addPendingDeletion = (id: string): void => {
  if (!mediaSessionUserId) return;
  const pending = getPendingDeletions();
  pending.add(id);
  localStorage.setItem(`${PENDING_DELETIONS_KEY}:${mediaSessionUserId}`, JSON.stringify([...pending]));
};

const removePendingDeletion = (id: string): void => {
  if (!mediaSessionUserId) return;
  const pending = getPendingDeletions();
  pending.delete(id);
  if (pending.size === 0) {
    localStorage.removeItem(`${PENDING_DELETIONS_KEY}:${mediaSessionUserId}`);
  } else {
    localStorage.setItem(`${PENDING_DELETIONS_KEY}:${mediaSessionUserId}`, JSON.stringify([...pending]));
  }
};

const retryPendingDeletions = async (): Promise<void> => {
  if (!supabase || !await bindMediaSession()) return;
  const pending = getPendingDeletions();
  if (pending.size === 0) return;

  console.log(`Retrying ${pending.size} pending deletion(s)...`);

  for (const id of pending) {
    try {
      const { error } = await supabase.from('generations').delete().eq('id', id);
      if (!error) {
        removePendingDeletion(id);
        try {
          await supabase.storage.from(MEDIA_BUCKET_NAME).remove([
            getOriginalStoragePath(id),
            getThumbnailStoragePath(id)
          ]);
        } catch { /* storage cleanup is best-effort */ }
      }
    } catch { /* will retry next time */ }
  }
};

// --- Helper: Create Thumbnail ---
const createThumbnail = (dataUrl: string, maxWidth = 400, quality = 0.8): Promise<Blob> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ratio = maxWidth / img.width;
      const scale = ratio < 1 ? ratio : 1;

      canvas.width = Math.floor(img.width * scale);
      canvas.height = Math.floor(img.height * scale);

      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error("Canvas context failed"));
        return;
      }

      // Enable image smoothing for better quality downscaling
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

      // Use PNG so the filename, mime type, and storage metadata stay in sync.
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error("Thumbnail creation failed"));
      }, 'image/png', quality);
    };
    img.onerror = (e) => reject(e);
    img.src = dataUrl;
  });
};

const createVideoThumbnail = (videoBlob: Blob, maxWidth = 640): Promise<Blob> => {
  return new Promise((resolve, reject) => {
    if (typeof document === 'undefined') {
      reject(new Error('Video thumbnail generation requires a browser'));
      return;
    }

    const objectUrl = URL.createObjectURL(videoBlob);
    const video = document.createElement('video');
    let timeoutId: number | undefined;
    let settled = false;

    const cleanup = () => {
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
      video.pause();
      video.removeAttribute('src');
      video.load();
      URL.revokeObjectURL(objectUrl);
    };
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error instanceof Error ? error : new Error('Video thumbnail generation failed'));
    };
    const capture = () => {
      if (settled) return;
      const sourceWidth = video.videoWidth;
      const sourceHeight = video.videoHeight;
      if (!sourceWidth || !sourceHeight) {
        fail(new Error('Video dimensions are unavailable'));
        return;
      }

      const scale = Math.min(1, maxWidth / sourceWidth);
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(sourceWidth * scale));
      canvas.height = Math.max(1, Math.round(sourceHeight * scale));
      const context = canvas.getContext('2d');
      if (!context) {
        fail(new Error('Canvas context failed'));
        return;
      }

      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = 'high';
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((blob) => {
        if (!blob) {
          fail(new Error('Video thumbnail encoding failed'));
          return;
        }
        if (settled) return;
        settled = true;
        cleanup();
        resolve(blob);
      }, 'image/png');
    };

    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.onloadedmetadata = () => {
      const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
      // The first few frames are often a fade from black. Capture around 10%
      // into the clip (capped at one second) so the durable gallery poster is
      // representative instead of looking like a missing thumbnail.
      const targetTime = duration > 0.2
        ? Math.min(1, Math.max(0.1, duration * 0.1))
        : 0;
      if (targetTime <= 0) {
        if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) capture();
        else video.onloadeddata = capture;
        return;
      }
      video.onseeked = capture;
      video.currentTime = targetTime;
    };
    video.onerror = () => fail(new Error('Video could not be decoded for its thumbnail'));
    timeoutId = window.setTimeout(() => fail(new Error('Video thumbnail generation timed out')), 15_000);
    video.src = objectUrl;
    video.load();
  });
};

// --- Helper: Compress Image for Reference ---
export const compressImage = (dataUrl: string, maxWidth = 1024, quality = 0.85): Promise<string> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ratio = maxWidth / img.width;
      const scale = ratio < 1 ? ratio : 1;

      canvas.width = Math.floor(img.width * scale);
      canvas.height = Math.floor(img.height * scale);

      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error("Canvas context failed"));
        return;
      }

      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

      // Return as JPEG for smaller size
      const compressedDataUrl = canvas.toDataURL('image/jpeg', quality);
      resolve(compressedDataUrl);
    };
    img.onerror = (e) => reject(e);
    img.src = dataUrl;
  });
};

// --- Helper: Estimate data URL size in bytes ---
export const estimateBase64Size = (dataUrl: string): number => {
  // Remove the data URL prefix to get just the base64 part
  const base64 = dataUrl.split(',')[1] || dataUrl;
  // Base64 encodes 3 bytes into 4 characters, so divide by 4/3
  return Math.ceil((base64.length * 3) / 4);
};

// --- IndexedDB Helpers ---
const openDB = async (expectedUserId?: string | null): Promise<IDBDatabase> => {
  const userId = await bindMediaSession();
  if (supabase && !userId) throw new Error('Not authenticated');
  if (expectedUserId !== undefined && userId !== expectedUserId) throw new Error('Media session changed');
  const scopedName = `${DB_NAME}:${userId || 'offline'}`;
  const factory = indexedDB;
  let shared = sharedConnections.get(factory);
  if (!shared) sharedConnections.set(factory, shared = new Map());
  const existing = shared.get(scopedName);
  if (existing) return existing;
  const connections = shared;
  const opening = new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open(scopedName, DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      cacheConnections.add(db);
      const forget = () => {
        db.close();
        cacheConnections.delete(db);
        if (connections.get(scopedName) === opening) connections.delete(scopedName);
      };
      db.onversionchange = forget;
      db.onclose = forget;
      resolve(db);
    };
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(TEMPLATE_STORE_NAME)) {
        db.createObjectStore(TEMPLATE_STORE_NAME, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(FOLDER_STORE_NAME)) {
        db.createObjectStore(FOLDER_STORE_NAME, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(REF_GALLERY_STORE_NAME)) {
        db.createObjectStore(REF_GALLERY_STORE_NAME, { keyPath: 'id' });
      }
    };
  });
  shared.set(scopedName, opening);
  // Forget any failed open, including one that threw synchronously, so a later call can retry.
  opening.catch(() => { if (connections.get(scopedName) === opening) connections.delete(scopedName); });
  return opening;
};

const mapRowToMedia = (row: any): GeneratedMedia => {
  const isVideo = row.type === 'video';
  const meta = row.metadata || {};
  const videoModel = isVideo ? resolveVideoModel(meta.videoModel || row.image_model) : undefined;
  const referenceVideos = sanitizePublicMediaRefs(meta.referenceVideos)
    .map(ref => ({ ...ref, url: resolveMediaReference(ref.url) || '' })) as ReferenceVideo[];
  const h3Mode = typeof meta.falEndpoint === 'string' && meta.falEndpoint.includes('h3-max/image-to-video')
    ? 'image_to_video' as const
    : typeof meta.falEndpoint === 'string' && meta.falEndpoint.includes('h3-max/text-to-video')
      ? 'text_only' as const
      : 'reference_to_video' as const;
  const modernH3Mode=normalizeH3MaxMode(meta.h3MaxMode)||Object.entries(H3_MAX_ENDPOINTS).find(([,endpoint])=>endpoint===meta.falEndpoint)?.[0] as GeneratedMedia['h3MaxMode'];
  const storedGenerationCost = meta.generationCost;
  const generationCost = videoModel === 'minimax-h3'
    && storedGenerationCost?.source !== 'provider_actual'
    ? modernH3Mode ? storedGenerationCost || estimateH3MaxCost({h3MaxMode:modernH3Mode,h3MaxOptions:meta.h3MaxOptions,videoQuality:meta.videoQuality||'768p',videoDuration:Number(meta.videoDuration)||5,referenceImages:row.reference_images||[],referenceVideos,referenceAudios:meta.referenceAudios||[]} as any) : estimateVideoCost(
        videoModel,
        (meta.videoQuality || '2K') as VideoQuality,
        Number(meta.videoDuration) || 5,
        referenceVideos.length > 0,
        referenceVideos.reduce((sum, video: any) => sum + Math.max(0, Number(video.duration) || 0), 0),
        resolveVideoOperation(meta.videoOperation),
        Math.max(0, Number(referenceVideos[0]?.duration) || 0),
        Array.isArray(row.reference_images) ? row.reference_images.length : 0,
        h3Mode,
      )
    : storedGenerationCost;
  const parsedGenerationStartedAt = Number(meta.generationStartedAt);
  const parsedGenerationCompletedAt = Number(meta.generationCompletedAt);
  const generationStartedAt = meta.generationStartedAt != null
    && Number.isFinite(parsedGenerationStartedAt)
    && parsedGenerationStartedAt > 0
    ? parsedGenerationStartedAt
    : undefined;
  const generationCompletedAt = meta.generationCompletedAt != null
    && Number.isFinite(parsedGenerationCompletedAt)
    && parsedGenerationCompletedAt > 0
    ? parsedGenerationCompletedAt
    : undefined;
  const timestampGenerationTime = generationStartedAt != null
    && generationCompletedAt != null
    && generationCompletedAt >= generationStartedAt
    ? Math.max(1, Math.round((generationCompletedAt - generationStartedAt) / 1000))
    : undefined;
  return {
    id: row.id,
    generationProvider: meta.generationProvider || (row.task_id?.startsWith('bs_openrouter_') ? 'openrouter' : row.task_id?.startsWith('bs_fal_') ? 'fal' : undefined), providerModel: meta.providerModel,
    url: resolveOriginalUrl(row),
    // Images can use the legacy derived thumbnail convention. Historical
    // video rows never created that file, so deriving one gives mobile Safari
    // a broken poster URL and suppresses the video preview entirely.
    thumbnailUrl: isVideo ? resolveVideoThumbnailUrl(row) : resolveThumbnailUrl(row),
    storagePath: row.storage_path || extractStoragePathFromUrl(row.url) || (isVideo ? `${row.id}.mp4` : getOriginalStoragePath(row.id)),
    thumbnailPath: isVideo ? resolveVideoThumbnailPath(row) : resolveThumbnailPath(row),
    syncStatus: 'synced',
    prompt: row.prompt,
    originalPrompt: typeof meta.originalPrompt === 'string'
      ? meta.originalPrompt
      : undefined,
    promptPreparation: normalizePromptPreparation(meta.promptPreparation),
    youtubeSource: normalizeYouTubeSource(meta.youtubeSource),
    providerExpandedPrompt: typeof meta.providerExpandedPrompt === 'string' && meta.providerExpandedPrompt.length > 0
      ? meta.providerExpandedPrompt
      : undefined,
    aspectRatio: row.aspect_ratio || '1:1',
    resolution: row.resolution || '1K',
    imageModel: isVideo ? undefined : (row.image_model || row.imageModel || DEFAULT_IMAGE_MODEL),
    openaiImageOptions: meta.openaiImageOptions,
    imageOutputSize: meta.imageOutputSize,
    imageEditProtection: meta.imageEditProtection,
    imageEditSourceId: meta.imageEditSourceId,
    imageRequestedSize: meta.imageRequestedSize,
    imageGenerationPrompt: meta.imageGenerationPrompt,
    imageGenerationReferenceIds: meta.imageGenerationReferenceIds,
    imagePromptCategory: meta.imagePromptCategory,
    openaiUsage: meta.openaiUsage,
    openaiStartedAt: meta.openaiStartedAt,
    imageQueue: meta.imageQueue?.version === 1 ? { version: 1, queuedAt: Number(meta.imageQueue.queuedAt) || row.created_at } : undefined,
    imageStage: meta.imageQueue?.version === 1 && row.status === 'pending' ? 'queued' : undefined,
    imageQueueWaitReason: meta.imageQueueWaitReason === 'quota' ? 'quota' : meta.imageQueueWaitReason === 'rate' ? 'rate' : undefined,
    createdAt: row.created_at,
    referenceImages: (row.reference_images || []).map((ref: any) => withoutLegacyMask({ ...ref, data: resolveMediaReference(ref.data) })),
    folderId: row.folder_id || null,
    isFavorite: row.is_favorite || false,
    mediaType: isVideo ? 'video' : 'image',
    videoModel,
    videoOperation: isVideo ? resolveVideoOperation(meta.videoOperation) : undefined,
    videoAspectRatio: meta.videoAspectRatio || (isVideo ? row.aspect_ratio : undefined),
    videoQuality: meta.videoQuality || (isVideo ? '720p' : undefined),
    videoDuration: meta.videoDuration,
    audioEnabled: meta.audioEnabled,
    videoPromptExpansionMode: meta.videoPromptExpansionMode,
    h3MaxMode: modernH3Mode,
    h3MaxOptions: meta.h3MaxOptions,
    videoOutputDuration: meta.videoOutputDuration,
    generationCost,
    generationTime: timestampGenerationTime ?? meta.generationTime,
    generationStartedAt,
    generationCompletedAt,
    submissionHeartbeatAt: isVideo && typeof meta.submissionHeartbeatAt === 'number'
      && Number.isFinite(meta.submissionHeartbeatAt) && meta.submissionHeartbeatAt > 0
      ? meta.submissionHeartbeatAt
      : undefined,
    referenceVideos,
    referenceAudios: sanitizePublicMediaRefs(meta.referenceAudios as ReferenceAudio[])
      .map(ref => ({ ...ref, url: resolveMediaReference(ref.url) || '' })),
    error: (row.status === 'failed') ? meta.error : undefined,
    taskId: row.task_id,
    status: row.status || 'completed',
    isLoading: row.status === 'pending' || row.status === 'processing',
    falRequestId: meta.falRequestId,
    falEndpoint: meta.falEndpoint,
    falQueueEndpoint: meta.falQueueEndpoint,
  };
};

const readImagesFromIndexedDb = async (): Promise<GeneratedMedia[]> => {
  try {
    const db = await openDB();
    const keys = await new Promise<string[]>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).getAllKeys();
      req.onsuccess = () => resolve(req.result as string[]);
      req.onerror = () => reject(req.error);
    });

    const images: GeneratedMedia[] = [];
    for (const key of keys) {
      const media = await new Promise<GeneratedMedia | null>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const req = tx.objectStore(STORE_NAME).get(key);
        req.onsuccess = () => resolve(req.result as GeneratedMedia);
        req.onerror = () => reject(req.error);
      });
      
      if (media) {
        await hydrateMediaRows([{
          url: media.url, thumbnail_url: media.thumbnailUrl, type: media.mediaType,
          reference_images: media.referenceImages, metadata: { referenceVideos: media.referenceVideos, referenceAudios: media.referenceAudios },
        }]);
        media.url = resolveMediaReference(media.url) || '';
        media.thumbnailUrl = resolveMediaReference(media.thumbnailUrl);
        media.referenceImages = media.referenceImages?.map(ref => withoutLegacyMask({ ...ref, data: resolveMediaReference(ref.data) }));
        media.referenceVideos = media.referenceVideos?.map(ref => ({ ...ref, url: resolveMediaReference(ref.url) || '' }));
        media.referenceAudios = media.referenceAudios?.map(ref => ({ ...ref, url: resolveMediaReference(ref.url) || '' }));
        // Convert large base64 URLs to Blob URLs to save massive amounts of JS heap memory
        if (media.url && media.url.startsWith('data:')) {
          try {
            const res = await fetch(media.url);
            const blob = await res.blob();
            media.url = createLocalMediaObjectUrl(blob);
          } catch (e) {
            console.error("Failed to convert base64 to blob url", e);
          }
        }
        if (media.thumbnailUrl && media.thumbnailUrl.startsWith('data:')) {
          try {
            const res = await fetch(media.thumbnailUrl);
            const blob = await res.blob();
            media.thumbnailUrl = createLocalMediaObjectUrl(blob);
          } catch (e) {
            console.error("Failed to convert base64 to blob url", e);
          }
        }
        if (media.referenceImages) {
          for (const ref of media.referenceImages) {
            if (ref.data && ref.data.startsWith('data:')) {
               try {
                 const res = await fetch(ref.data);
                 const blob = await res.blob();
                 ref.data = createLocalMediaObjectUrl(blob);
               } catch (e) {}
            }
          }
        }
        images.push(media);
      }
    }
    return images;
  } catch (error) {
    console.error("Error reading media from IndexedDB:", error);
    return [];
  }
};

const putImageInIndexedDb = async (media: GeneratedMedia, expectedUserId?: string | null): Promise<void> => {
  try {
    const db = await openDB(expectedUserId);
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.put({
        ...media, url: persistMediaReference(media.url), thumbnailUrl: persistMediaReference(media.thumbnailUrl),
        referenceImages: media.referenceImages?.map(ref => withoutLegacyMask({ ...ref, data: persistMediaReference(ref.data) })),
        referenceVideos: media.referenceVideos?.map(ref => ({ ...ref, url: persistMediaReference(ref.url) })),
        referenceAudios: media.referenceAudios?.map(ref => ({ ...ref, url: persistMediaReference(ref.url) })),
      });
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } catch (error) {
    console.error("Error saving media to IndexedDB:", error);
  }
};

const deleteImagesFromIndexedDb = async (ids: string[]): Promise<void> => {
  if (ids.length === 0) return;

  try {
    const db = await openDB();
    await new Promise<void>((resolve) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      ids.forEach(id => store.delete(id));
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => resolve();
    });
  } catch (error) {
    console.error("Error deleting media from IndexedDB:", error);
  }
};

const clearImagesFromIndexedDb = async (): Promise<void> => {
  try {
    const db = await openDB();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch (error) {
    console.error("Error clearing IndexedDB images:", error);
  }
};

const mergeMediaCollections = (primary: GeneratedMedia[], secondary: GeneratedMedia[]): GeneratedMedia[] => {
  const merged = new Map<string, GeneratedMedia>();

  [...primary, ...secondary].forEach(media => {
    if (!media?.id) return;
    if (!merged.has(media.id)) {
      merged.set(media.id, media);
    }
  });

  return Array.from(merged.values()).sort((a, b) => b.createdAt - a.createdAt);
};

const getPendingLocalImages = (images: GeneratedMedia[]): GeneratedMedia[] => {
  return images
    .filter(isLocalOnlyMedia)
    .map((media) => ({ ...media, syncStatus: 'local-only' }));
};

type GenerationRowsProgressHandler = (rows: any[]) => void | Promise<void>;

const selectPagedGenerationRows = async (
  userId: string | null,
  columns: string,
  onProgress?: GenerationRowsProgressHandler,
): Promise<{ data: any[] | null; error: any }> => {
  const rows: any[] = [];
  let from = 0;

  while (true) {
    // Match the gallery's initial 48-card window so first paint does not wait
    // for the user's entire generation history. Subsequent pages stay large to
    // finish the background hydration with fewer Supabase round trips.
    const pageSize = from === 0
      ? INITIAL_GENERATIONS_PAGE_SIZE
      : BACKGROUND_GENERATIONS_PAGE_SIZE;
    let query = supabase
      .from('generations')
      .select(columns)
      .order('created_at', { ascending: false })
      // Stable page boundaries when a batch shares the same creation time.
      // Gallery applies the brainstorm's numeric slot order after filtering.
      .order('id', { ascending: true })
      .range(from, from + pageSize - 1);

    if (userId) {
      query = query.eq('user_id', userId);
    }

    const { data, error } = await query;
    if (error) return { data: null, error };
    if (!data || data.length === 0) break;

    rows.push(...data);
    await onProgress?.([...rows]);

    // Data API max_rows may be lower than our requested page size.
    // Only an empty page proves exhaustion; advance by rows actually received.
    from += data.length;
  }

  return { data: rows, error: null };
};

const selectGenerationRowsForUser = async (
  userId: string,
  onProgress?: GenerationRowsProgressHandler,
): Promise<any[]> => {
  let { data, error } = await selectPagedGenerationRows(
    userId,
    'id, prompt, url, thumbnail_url, storage_path, thumbnail_path, type, aspect_ratio, resolution, image_model, created_at, folder_id, is_favorite, metadata, task_id, status',
    onProgress,
  );

  // Backward compatibility when the DB schema doesn't have the new metadata yet.
  if (error && error.code === '42703') {
    const fallbackWithModel = await selectPagedGenerationRows(
      userId,
      'id, prompt, url, type, aspect_ratio, resolution, image_model, created_at, folder_id, is_favorite',
      onProgress,
    );
    data = fallbackWithModel.data;
    error = fallbackWithModel.error as any;
  }

  // Backward compatibility when the DB schema doesn't have image_model yet.
  if (error && error.code === '42703') {
    const fallbackLegacy = await selectPagedGenerationRows(
      userId,
      'id, prompt, url, type, aspect_ratio, resolution, created_at, folder_id, is_favorite',
      onProgress,
    );
    data = fallbackLegacy.data;
    error = fallbackLegacy.error as any;
  }

  if (error) {
    if (error.code === '42703') {
      console.error('Supabase Schema Mismatch: Missing columns. Run the SQL migration.');
    }
    throw error;
  }

  return data || [];
};

// --- Image Methods ---

export const saveImage = async (media: GeneratedMedia, expectedUserId?: string): Promise<{
  publicUrl: string;
  thumbnailUrl?: string;
  storagePath: string;
  thumbnailPath: string;
} | undefined> => {
  const operationUserId = await bindMediaSession();
  if (supabase && !operationUserId) return undefined;
  if (expectedUserId && operationUserId !== expectedUserId) return undefined;
  const assertSameUser = async () => {
    if (await bindMediaSession() !== operationUserId) throw new Error('Media session changed');
  };
  if (supabase) {
    try {
      const userId = operationUserId;
      if (!userId) throw new Error('Not authenticated');

      const storagePath = media.storagePath?.startsWith(`${userId}/`) || media.storagePath?.startsWith(`openai/${userId}/`)
        ? media.storagePath : `${userId}/${getOriginalStoragePath(media.id)}`;
      const thumbnailPath = media.thumbnailPath?.startsWith(`${userId}/`)
        ? media.thumbnailPath : `${userId}/${getThumbnailStoragePath(media.id)}`;

      const downloadUrl = await refreshMediaAccessUrl(media.url, false);
      const res = await fetch(downloadUrl);
      if (!res.ok) throw new Error('Saved image could not be downloaded.');
      const originalBlob = await res.blob();

      let thumbBlob: Blob | null = null;
      try {
        thumbBlob = await createThumbnail(downloadUrl);
      } catch (err) {
        console.warn("Thumbnail generation failed, skipping", err);
      }

      // Handle reference images - upload base64 ones to storage to avoid DB size limits
      const safeReferenceImages = await Promise.all((media.referenceImages || []).map(withoutLegacyMask).map(async (ref) => {
        if (!ref.data) {
          throw new Error(`Reference image ${ref.id || 'unknown'} has no source data and was not saved.`);
        }
        if (ref.data.startsWith('http')) {
          return withoutLegacyMask({ ...ref, data: persistMediaReference(ref.data) }); // Keep object references without bearer tokens
        }

        try {
          const refPath = `${userId}/refs/${media.id}_${ref.id}.jpg`;
          const res = await fetch(ref.data);
          const refBlob = await res.blob();

          await assertSameUser();

          const { error: refUploadError } = await supabase.storage
            .from(MEDIA_BUCKET_NAME)
            .upload(refPath, refBlob, {
              contentType: refBlob.type || 'image/jpeg',
              cacheControl: '0',
              upsert: true
            });

          if (!refUploadError) {
            const publicUrl = getStorageReferenceUrl(refPath);
            if (publicUrl) {
              return { ...ref, data: publicUrl };
            }
          }
        } catch (e) {
          console.error("Failed to upload reference image", e);
        }

        // Never persist an identity/reference row without its source bytes.
        // A missing ref is worse than a local-only result: it looks complete
        // in the gallery but later regenerations silently lose the identity.
        throw new Error(`Reference image ${ref.id || 'unknown'} could not be persisted. The generated image was kept locally; retry saving after the connection recovers.`);
      }));

      // OpenAI already stores the original on the server. Keep its chosen
      // format/alpha and avoid uploading a large result a second time.
      const isStoredOpenAIImage = media.imageModel === 'gpt-image-2.5-sunburst'
        && media.storagePath?.startsWith(`openai/${userId}/`)
        && extractStoragePathFromUrl(downloadUrl) === media.storagePath;
      await assertSameUser();
      if (!isStoredOpenAIImage) {
        const { error: uploadError } = await supabase.storage
          .from(MEDIA_BUCKET_NAME)
          .upload(storagePath, originalBlob, {
            contentType: originalBlob.type || 'image/png',
            cacheControl: '0',
            upsert: true
          });
        if (uploadError) throw new Error(`Storage upload failed: ${uploadError.message}`);
      }

      if (thumbBlob) {
        await assertSameUser();
        await supabase.storage
          .from(MEDIA_BUCKET_NAME)
          .upload(thumbnailPath, thumbBlob, {
            contentType: 'image/png',
            cacheControl: '0',
            upsert: true
          });
      }

      const publicUrl = await createMediaAccessUrl(storagePath);
      if (!publicUrl) throw new Error('Could not authorize access to the saved image.');
      const resolvedThumbnailPath = thumbBlob ? thumbnailPath : null;
      const thumbnailUrl = thumbBlob ? await createMediaAccessUrl(thumbnailPath) : undefined;

      // Retain diagnostics and prompt/edit metadata when enriching the saved
      // image; upsert replaces the JSON column wholesale.
      let existingImageMetadata: Record<string, unknown> = {};
      const hasImageMetadata = media.imageModel === 'gpt-image-2.5-sunburst' || media.imageEditSourceId
        || media.imageEditProtection || media.promptPreparation || media.youtubeSource || media.originalPrompt != null;
      if (hasImageMetadata) {
        const { data, error } = await supabase.from('generations').select('metadata').eq('id', media.id).maybeSingle();
        if (error) throw new Error(`Could not preserve the saved image details: ${error.message}`);
        existingImageMetadata = data?.metadata || {};
      }
      // Save reference images using the safe version
      const generationInsertBase = {
        id: media.id,
        user_id: userId,
        prompt: media.prompt,
        url: getStorageReferenceUrl(storagePath),
        type: 'image',
        aspect_ratio: media.aspectRatio,
        resolution: media.resolution,
        created_at: media.createdAt,
        reference_images: safeReferenceImages,
        folder_id: media.folderId,
        is_favorite: media.isFavorite || false,
        ...(media.imageModel === 'gpt-image-2.5-sunburst' ? { metadata: {
          ...existingImageMetadata,
          ...(media.promptPreparation ? { promptPreparation: normalizePromptPreparation(media.promptPreparation) } : {}),
          ...(media.youtubeSource ? { youtubeSource: normalizeYouTubeSource(media.youtubeSource) } : {}),
          originalPrompt: media.originalPrompt, openaiImageOptions: media.openaiImageOptions,
          imageOutputSize: media.imageOutputSize, openaiUsage: media.openaiUsage,
          imageEditProtection: media.imageEditProtection,
          imageEditSourceId: media.imageEditSourceId,
          imageRequestedSize: media.imageRequestedSize, imageGenerationPrompt: media.imageGenerationPrompt,
          imageGenerationReferenceIds: media.imageGenerationReferenceIds,
          imagePromptCategory: media.imagePromptCategory,
          openaiStartedAt: media.openaiStartedAt, generationCost: media.generationCost,
          generationStartedAt: media.generationStartedAt, generationCompletedAt: media.generationCompletedAt,
          generationTime: media.generationTime,
        } } : hasImageMetadata ? { metadata: { ...existingImageMetadata,
          ...(media.youtubeSource ? { youtubeSource: normalizeYouTubeSource(media.youtubeSource) } : {}),
          ...(media.promptPreparation ? { promptPreparation: normalizePromptPreparation(media.promptPreparation) } : {}), imageEditSourceId: media.imageEditSourceId,
          imageEditProtection: media.imageEditProtection, originalPrompt: media.originalPrompt,
          imagePromptCategory: media.imagePromptCategory, imageOutputSize: media.imageOutputSize } } : {}),
      };

      const generationInsertWithPaths = {
        ...generationInsertBase,
        thumbnail_url: thumbBlob ? getStorageReferenceUrl(thumbnailPath) : null,
        storage_path: storagePath,
        thumbnail_path: resolvedThumbnailPath
      };

      // Upsert (not insert) so calls coming from a fal-backed flow that has
      // already inserted a pending row via createPendingImage update the
      // existing row instead of failing on PK conflict.
      await assertSameUser();
      let { error: dbError } = await supabase
        .from('generations')
        .upsert({
          ...generationInsertWithPaths,
          image_model: media.imageModel || DEFAULT_IMAGE_MODEL,
          status: 'completed',
        } as any, { onConflict: 'id' });

      if (dbError && dbError.code === '42703') {
        const fallback = await supabase
          .from('generations')
          .upsert({
            ...generationInsertBase,
            image_model: media.imageModel || DEFAULT_IMAGE_MODEL,
          } as any, { onConflict: 'id' });
        dbError = fallback.error as any;
      }

      if (dbError && dbError.code === '42703') {
        const legacy = await supabase
          .from('generations')
          .upsert(generationInsertBase as any, { onConflict: 'id' });
        dbError = legacy.error as any;
      }

      if (dbError) throw new Error(`DB upsert failed: ${dbError.message}`);

      await deleteImagesFromIndexedDb([media.id]);
      return { publicUrl, thumbnailUrl, storagePath, thumbnailPath: resolvedThumbnailPath || thumbnailPath };
    } catch (e: any) {
      if (e.message && e.message.includes('42703')) {
        console.error("Missing DB Column: Please run the provided SQL migration.");
      }
      console.warn("Supabase save failed, falling back to local DB.", e.message || e);
    }
  }

  try {
    await assertSameUser();
    await putImageInIndexedDb({ ...media, syncStatus: 'local-only' }, operationUserId);
    return undefined;
  } catch {
    return undefined;
  }
};

const mergeVideoMetadata = (existing: Record<string, any>, incoming: Record<string, any>): Record<string, any> => {
  const merged = { ...existing, ...incoming };
  // A resumed/stale client can still hold the admission estimate after the
  // server reconciles billing. Keep that measured cost, including an actual
  // zero charge, while allowing subsequent provider corrections to replace it.
  if (existing.generationCost?.source === 'provider_actual'
    && incoming.generationCost?.source === 'published_estimate') {
    merged.generationCost = existing.generationCost;
  }
  return merged;
};

// A retry after a failed row save reuses the stored file instead of moving the video again.
const completedVideoTransfers = new Map<string, { source: string; storagePath: string; thumbnailPath: string | null; pendingThumbnail?: Blob }>();
// Overlapping transfers of one generation can leave either source in the stored file, so none of them records it.
const activeVideoTransfers = new Map<string, Set<{ overlapped: boolean }>>();

export const saveVideo = async (
  media: GeneratedMedia,
  expectedUserId?: string,
): Promise<{ publicUrl: string; thumbnailUrl?: string; storagePath: string; thumbnailPath: string } | undefined> => {
  if (!supabase) return undefined;

  try {
    const { data: { session } } = await supabase.auth.getSession();
    const userId = session?.user?.id;
    if (!userId) { console.warn('saveVideo: no userId'); return undefined; }
    if (expectedUserId && userId !== expectedUserId) return undefined;
    const assertSameUser = async () => {
      if (await bindMediaSession() !== userId) throw new Error('Media session changed');
    };
    await assertSameUser();

    const videoUrl = media.url;
    if (!videoUrl) { console.warn('saveVideo: no videoUrl'); return undefined; }

    const storagePath = `${userId}/${media.id}.mp4`;
    const thumbnailPath = `${userId}/${media.id}_thumb.png`;

    let publicUrl = videoUrl;
    let uploadedStoragePath: string | null = null;
    let thumbnailUrl = media.thumbnailUrl;
    let uploadedThumbnailPath: string | null = media.thumbnailPath || null;

    const transferKey = `${userId}:${media.id}`;
    const previousTransfer = completedVideoTransfers.get(transferKey);
    // Another source overwrites the same stored file, so its entry no longer describes it.
    if (previousTransfer && previousTransfer.source !== videoUrl) completedVideoTransfers.delete(transferKey);
    const reusedUrl = previousTransfer?.source === videoUrl ? await createMediaAccessUrl(previousTransfer.storagePath) : undefined;
    if (previousTransfer && reusedUrl) {
      publicUrl = reusedUrl;
      uploadedStoragePath = previousTransfer.storagePath;
      await assertSameUser();
      // The poster is optional: retry a failed poster upload, but never block the video row on it.
      try {
        if (!previousTransfer.thumbnailPath && previousTransfer.pendingThumbnail) {
          const { error: thumbnailUploadError } = await supabase.storage.from(MEDIA_BUCKET_NAME)
            .upload(thumbnailPath, previousTransfer.pendingThumbnail, { contentType: 'image/png', cacheControl: '0', upsert: true });
          if (!thumbnailUploadError) { previousTransfer.thumbnailPath = thumbnailPath; delete previousTransfer.pendingThumbnail; }
        }
        if (previousTransfer.thumbnailPath) {
          // The row stores the durable path; a fresh signed URL is only for this session.
          uploadedThumbnailPath = previousTransfer.thumbnailPath;
          const reusedThumbnailUrl = await createMediaAccessUrl(previousTransfer.thumbnailPath);
          if (reusedThumbnailUrl) thumbnailUrl = reusedThumbnailUrl;
        }
      } catch (thumbnailError: any) {
        console.warn('Saved video poster could not be renewed:', thumbnailError?.message || thumbnailError);
      }
    } else if (!videoUrl.startsWith('data:')) {
      const activeTransfers = activeVideoTransfers.get(transferKey) || new Set<{ overlapped: boolean }>();
      const transfer = { overlapped: activeTransfers.size > 0 };
      activeTransfers.forEach(other => { other.overlapped = true; });
      activeTransfers.add(transfer); activeVideoTransfers.set(transferKey, activeTransfers);
      try {
        const response = await fetch(await refreshMediaAccessUrl(videoUrl, false));
        if (!response.ok) {
          throw new Error(`Video download failed (${response.status})`);
        }
        const responseType = (response.headers.get('content-type') || '').toLowerCase();
        if (responseType.includes('application/json') || responseType.startsWith('text/')) {
          throw new Error(`Video download returned ${responseType || 'a non-video response'}`);
        }
        const videoBlob = await response.blob();

        let thumbnailBlob: Blob | null = null;
        try {
          // Always create our own durable poster. Provider thumbnail URLs can
          // expire independently from the video and caused otherwise healthy
          // gallery cards to become blank after a few hours or days.
          thumbnailBlob = await createVideoThumbnail(videoBlob);
        } catch (thumbnailError: any) {
          console.warn('Video thumbnail generation failed:', thumbnailError?.message || thumbnailError);
        }

        // Some browser/codec combinations cannot draw the video frame to a
        // canvas. If the provider supplied an image poster, persist that image
        // into our own bucket instead of retaining its temporary URL.
        if (!thumbnailBlob && thumbnailUrl) {
          try {
            const thumbnailResponse = await fetch(thumbnailUrl);
            if (!thumbnailResponse.ok) throw new Error(`Thumbnail download failed (${thumbnailResponse.status})`);
            const responseType = (thumbnailResponse.headers.get('content-type') || '').toLowerCase();
            if (responseType && !responseType.startsWith('image/')) {
              throw new Error(`Thumbnail download returned ${responseType}`);
            }
            const downloadedThumbnail = await thumbnailResponse.blob();
            if (downloadedThumbnail.size > 0) {
              const localThumbnailUrl = URL.createObjectURL(downloadedThumbnail);
              try {
                thumbnailBlob = await createThumbnail(localThumbnailUrl, 640);
              } finally {
                URL.revokeObjectURL(localThumbnailUrl);
              }
            }
          } catch (thumbnailError: any) {
            console.warn('Provider thumbnail could not be persisted:', thumbnailError?.message || thumbnailError);
          }
        }

        await assertSameUser();
        const { error: uploadError } = await supabase.storage
          .from(MEDIA_BUCKET_NAME)
          .upload(storagePath, videoBlob, {
            contentType: 'video/mp4',
            cacheControl: '0',
            upsert: true,
          });

        if (uploadError) {
          throw new Error(`Video storage upload failed: ${uploadError.message}`);
        }
        const storagePublicUrl = await createMediaAccessUrl(storagePath);
        if (!storagePublicUrl) {
          throw new Error('Could not resolve the durable video URL after upload');
        }
        publicUrl = storagePublicUrl;
        uploadedStoragePath = storagePath;
        if (!transfer.overlapped) completedVideoTransfers.set(transferKey, { source: videoUrl, storagePath, thumbnailPath: null, ...(thumbnailBlob ? { pendingThumbnail: thumbnailBlob } : {}) });

        if (thumbnailBlob) {
          await assertSameUser();
          const { error: thumbnailUploadError } = await supabase.storage
            .from(MEDIA_BUCKET_NAME)
            .upload(thumbnailPath, thumbnailBlob, {
              contentType: 'image/png',
              cacheControl: '0',
              upsert: true,
            });
          if (thumbnailUploadError) {
            console.warn(`Video thumbnail upload failed: ${thumbnailUploadError.message}`);
          } else {
            const savedThumbnailUrl = await createMediaAccessUrl(thumbnailPath);
            if (savedThumbnailUrl) {
              thumbnailUrl = savedThumbnailUrl;
              uploadedThumbnailPath = thumbnailPath;
              if (!transfer.overlapped) completedVideoTransfers.set(transferKey, { source: videoUrl, storagePath, thumbnailPath });
            }
          }
        }
      } catch (fetchErr: any) {
        console.warn("Failed to fetch video for storage upload:", fetchErr.message);
        // An earlier save may have stored this video and recorded it on the row,
        // with only its status write lost. The provider URL can expire before
        // the task is resumed, so finish with that stored copy.
        try {
          const { data: saved, error: savedError } = await supabase.from('generations')
            .select('storage_path, thumbnail_path').eq('id', media.id).eq('user_id', userId).maybeSingle();
          const storedUrl = !savedError && saved?.storage_path === storagePath ? await createMediaAccessUrl(storagePath) : undefined;
          // Never persist the expiring provider URL; the caller retries the copy.
          if (!storedUrl) return undefined;
          publicUrl = storedUrl;
          uploadedStoragePath = storagePath;
          if (saved.thumbnail_path) {
            uploadedThumbnailPath = saved.thumbnail_path;
            // The poster is optional: a failed signature must not block the video row.
            try { thumbnailUrl = await createMediaAccessUrl(saved.thumbnail_path) || thumbnailUrl; } catch { /* Keep the stored path. */ }
          }
        } catch {
          return undefined;
        }
      } finally {
        activeTransfers.delete(transfer);
        if (!activeTransfers.size) activeVideoTransfers.delete(transferKey);
      }
    }

    const safeReferenceImages = await Promise.all((media.referenceImages || []).map(withoutLegacyMask).map(async (ref) => {
      if (!ref.data) throw new Error(`Reference image ${ref.id || 'unknown'} has no source data and was not saved.`);
      if (ref.data.startsWith('http')) return withoutLegacyMask({ ...ref, data: persistMediaReference(ref.data) });
      try {
        const refPath = `${userId}/refs/${media.id}_${ref.id}.jpg`;
        const res = await fetch(ref.data);
        const refBlob = await res.blob();
        await assertSameUser();
        const { error: refUploadError } = await supabase.storage.from(MEDIA_BUCKET_NAME).upload(refPath, refBlob, { contentType: refBlob.type || 'image/jpeg', cacheControl: '0', upsert: true });
        if (!refUploadError) {
          const refPublicUrl = getStorageReferenceUrl(refPath);
          if (refPublicUrl) return { ...ref, data: refPublicUrl };
        }
      } catch (e) { console.warn("Failed to upload video ref image", e); }
      throw new Error(`Reference image ${ref.id || 'unknown'} could not be persisted. The generated video was kept locally; retry saving after the connection recovers.`);
    }));

    // Read any existing metadata + reference_images so we MERGE rather than
    // blindly overwrite. Postgres' upsert replaces the entire JSONB metadata
    // column AND the reference_images column with the provided value, so
    // without this merge we'd silently drop fields like videoQuality /
    // videoDuration / generationCost AND wipe the reference_images array on
    // resumed videos where the in-memory media object was hydrated from the
    // gallery's lite SELECT (which omits the heavy reference_images column).
    let existingMeta: any = {};
    let existingReferenceImages: any[] | null = null;
    try {
      const { data: existingRow } = await supabase
        .from('generations')
        .select('metadata, reference_images')
        .eq('id', media.id)
        .maybeSingle();
      existingMeta = existingRow?.metadata || {};
      if (Array.isArray(existingRow?.reference_images)) {
        existingReferenceImages = existingRow.reference_images;
      }
    } catch {
      // Non-fatal: if the row doesn't exist or the read fails we just upsert fresh.
    }

    const safeReferenceVideos = sanitizePublicMediaRefs(media.referenceVideos);
    const safeReferenceAudios = sanitizePublicMediaRefs(media.referenceAudios);
    const existingReferenceVideos = sanitizePublicMediaRefs(existingMeta.referenceVideos);
    const existingReferenceAudios = sanitizePublicMediaRefs(existingMeta.referenceAudios);
    const finalReferenceVideos = safeReferenceVideos.length > 0 ? safeReferenceVideos : existingReferenceVideos;
    const finalReferenceAudios = safeReferenceAudios.length > 0 ? safeReferenceAudios : existingReferenceAudios;

    const newMeta: Record<string, any> = {
      videoModel: media.videoModel || DEFAULT_VIDEO_MODEL,
      videoOperation: media.videoOperation || 'generate',
      videoAspectRatio: media.videoAspectRatio,
      videoQuality: media.videoQuality,
      videoDuration: media.videoDuration,
      audioEnabled: media.audioEnabled,
      videoPromptExpansionMode: media.videoPromptExpansionMode,
      h3MaxMode: media.h3MaxMode,
      h3MaxOptions: media.h3MaxOptions,
      videoOutputDuration: media.videoOutputDuration,
      originalPrompt: media.originalPrompt,
      promptPreparation: normalizePromptPreparation(media.promptPreparation),
      providerExpandedPrompt: media.providerExpandedPrompt,
      generationCost: media.generationCost,
      generationTime: media.generationTime,
      generationStartedAt: media.generationStartedAt,
      generationCompletedAt: media.generationCompletedAt,
      referenceVideos: finalReferenceVideos.length > 0 ? finalReferenceVideos.map(ref => ({ ...ref, url: persistMediaReference(ref.url) })) : undefined,
      referenceAudios: finalReferenceAudios.length > 0 ? finalReferenceAudios.map(ref => ({ ...ref, url: persistMediaReference(ref.url) })) : undefined,
      providerModel: media.providerModel || media.falEndpoint,
      generationProvider: media.generationProvider || (media.taskId?.startsWith('bs_openrouter_') ? 'openrouter' : media.taskId?.startsWith('bs_fal_') ? 'fal' : undefined),
      falEndpoint: media.falEndpoint,
      falQueueEndpoint: media.falQueueEndpoint,
    };
    // Only include defined values so existing fields aren't clobbered with undefined.
    const definedNewMeta: Record<string, any> = {};
    for (const [k, v] of Object.entries(newMeta)) {
      if (v !== undefined) definedNewMeta[k] = v;
    }
    const mergedMetadata = mergeVideoMetadata(existingMeta, definedNewMeta);

    // If the in-memory media has no refs but the existing DB row does,
    // preserve the DB version so we don't wipe references on resumed videos.
    const finalReferenceImages = (safeReferenceImages.length === 0 && existingReferenceImages && existingReferenceImages.length > 0)
      ? existingReferenceImages
      : safeReferenceImages;

    const generationInsertFull = {
      id: media.id,
      user_id: userId,
      prompt: media.prompt,
      url: uploadedStoragePath ? getStorageReferenceUrl(uploadedStoragePath) : publicUrl,
      type: 'video',
      aspect_ratio: media.videoAspectRatio || media.aspectRatio,
      resolution: media.videoQuality || media.resolution,
      created_at: media.createdAt,
      reference_images: finalReferenceImages.map(ref => withoutLegacyMask({ ...ref, data: persistMediaReference(ref.data) })),
      folder_id: media.folderId,
      is_favorite: media.isFavorite || false,
      storage_path: uploadedStoragePath,
      thumbnail_path: uploadedThumbnailPath,
      thumbnail_url: uploadedThumbnailPath ? getStorageReferenceUrl(uploadedThumbnailPath) : thumbnailUrl || null,
      image_model: media.videoModel || DEFAULT_VIDEO_MODEL,
      metadata: mergedMetadata,
    };

    // The row will already exist from createPendingVideo for the live-generation flow,
    // so we use UPSERT to avoid a primary-key conflict that would drop the durable
    // Supabase URL on the floor and leave the row pointing at an EvoLink URL that
    // expires in 24h (which is exactly what caused historical "Video unavailable"
    // entries in the gallery).
    await assertSameUser();
    let { error: dbError } = await supabase
      .from('generations')
      .upsert(generationInsertFull as any, { onConflict: 'id' });

    if (dbError && dbError.code === '42703') {
      console.warn('saveVideo: column mismatch, retrying without path columns. Error:', dbError.message);
      const { storage_path, thumbnail_path, thumbnail_url, ...withoutPaths } = generationInsertFull;
      const retry = await supabase.from('generations').upsert(withoutPaths as any, { onConflict: 'id' });
      dbError = retry.error as any;
    }

    if (dbError && dbError.code === '42703') {
      console.warn('saveVideo: column mismatch, retrying without image_model. Error:', dbError.message);
      const { storage_path, thumbnail_path, thumbnail_url, image_model, ...minimal } = generationInsertFull;
      const retry = await supabase.from('generations').upsert(minimal as any, { onConflict: 'id' });
      dbError = retry.error as any;
    }

    if (dbError) {
      console.error("saveVideo DB upsert failed:", dbError.code, dbError.message, JSON.stringify(dbError));
      return undefined;
    }
    completedVideoTransfers.delete(transferKey);

    return {
      publicUrl,
      thumbnailUrl,
      storagePath: uploadedStoragePath || storagePath,
      thumbnailPath: uploadedThumbnailPath || thumbnailPath,
    };
  } catch (e: any) {
    console.error("saveVideo exception:", e.message || e);
    return undefined;
  }
};

export const createPendingVideo = async (
  id: string,
  taskId: string,
  prompt: string,
  config: { videoModel?: VideoModelId; videoOperation?: VideoOperation; videoAspectRatio?: string; videoQuality?: string; videoDuration?: number; audioEnabled?: boolean; videoPromptExpansionMode?: string; h3MaxMode?: GeneratedMedia['h3MaxMode']; h3MaxOptions?: GeneratedMedia['h3MaxOptions']; folderId?: string | null; referenceImages?: any[]; referenceVideos?: any[]; referenceAudios?: any[]; generationCost?: any; generationStartedAt?: number; originalPrompt?: string; promptPreparation?: GeneratedMedia['promptPreparation'] }
): Promise<boolean> => {
  if (!supabase) return false;
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const userId = session?.user?.id;
    if (!userId) return false;

    // Same reasoning as createPendingImage — strip raw base64 ref data so
    // the pending-video INSERT is a small JSONB write, not several MB.
    const safeRefs = (config.referenceImages || []).map((ref: any) => {
      if (ref?.data && typeof ref.data === 'string' && !ref.data.startsWith('http')) {
        const { data, mask, ...rest } = ref;
        return rest;
      }
      return withoutLegacyMask({ ...ref, data: persistMediaReference(ref.data) });
    });

    const { error } = await supabase.from('generations').insert({
      id,
      user_id: userId,
      prompt,
      url: '',
      type: 'video',
      aspect_ratio: config.videoAspectRatio || '16:9',
      resolution: config.videoQuality || '720p',
      created_at: Date.now(),
      reference_images: safeRefs,
      folder_id: config.folderId || null,
      is_favorite: false,
      image_model: config.videoModel || DEFAULT_VIDEO_MODEL,
      task_id: taskId,
      status: 'pending',
      metadata: {
        videoModel: config.videoModel || DEFAULT_VIDEO_MODEL,
        videoOperation: config.videoOperation || 'generate',
        videoAspectRatio: config.videoAspectRatio,
        videoQuality: config.videoQuality,
        videoDuration: config.videoDuration,
        audioEnabled: config.audioEnabled,
        videoPromptExpansionMode: config.videoPromptExpansionMode,
        h3MaxMode: config.h3MaxMode,
        h3MaxOptions: config.h3MaxOptions,
        originalPrompt: config.originalPrompt,
        promptPreparation: normalizePromptPreparation(config.promptPreparation),
        generationCost: config.generationCost,
        generationStartedAt: config.generationStartedAt,
        submissionHeartbeatAt: Date.now(),
        referenceVideos: sanitizePublicMediaRefs(config.referenceVideos).map(ref => ({ ...ref, url: persistMediaReference(ref.url) })),
        referenceAudios: sanitizePublicMediaRefs(config.referenceAudios).map(ref => ({ ...ref, url: persistMediaReference(ref.url) })),
      },
    } as any);

    if (error) { console.error('createPendingVideo failed:', error.message); return false; }
    return true;
  } catch (e: any) {
    console.error('createPendingVideo error:', e.message);
    return false;
  }
};

/**
 * Insert a placeholder image row immediately when a fal.ai image task is
 * about to be submitted. The row is updated to 'completed' or 'failed' once
 * polling resolves; if the user closes the tab, the resume-on-boot logic in
 * App.tsx finds the row, reads the fal request_id from metadata, and resumes
 * polling so the generation isn't lost.
 */
export const createPendingImage = async (
  id: string,
  prompt: string,
  config: {
    aspectRatio?: string;
    resolution?: string;
    imageModel?: string;
    folderId?: string | null;
    referenceImages?: any[];
    originalPrompt?: string;
    promptPreparation?: GeneratedMedia['promptPreparation'];
    youtubeSource?: GeneratedMedia['youtubeSource'];
    imagePromptCategory?: GeneratedMedia['imagePromptCategory'];
    imageEditSourceId?: string;
  }
): Promise<boolean> => {
  if (!supabase) return false;
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const userId = session?.user?.id;
    if (!userId) return false;

    // The pending row only needs to identify which refs are attached, NOT
    // their pixel data — base64 still in memory will be uploaded via
    // saveImage on completion. Storing inline base64 here was the cause of
    // the "canceling statement due to statement timeout" bursts when 10
    // brainstorm generations all tried to insert ~4 MB JSONB rows in
    // parallel. Keep id + mimeType + role flags + any URL-style data; drop
    // raw base64 unconditionally.
    const safeRefs = (config.referenceImages || []).map((ref: any) => {
      if (ref?.data && typeof ref.data === 'string' && !ref.data.startsWith('http')) {
        const { data, mask, ...rest } = ref;
        return rest;
      }
      return withoutLegacyMask({ ...ref, data: persistMediaReference(ref.data) });
    });

    const { error } = await supabase.from('generations').insert({
      id,
      user_id: userId,
      prompt,
      url: '',
      type: 'image',
      aspect_ratio: config.aspectRatio || '1:1',
      resolution: config.resolution || '1K',
      created_at: Date.now(),
      reference_images: safeRefs,
      folder_id: config.folderId || null,
      is_favorite: false,
      image_model: config.imageModel || DEFAULT_IMAGE_MODEL,
      status: 'pending',
      metadata: {
        originalPrompt: config.originalPrompt,
        promptPreparation: normalizePromptPreparation(config.promptPreparation),
        youtubeSource: normalizeYouTubeSource(config.youtubeSource),
        imagePromptCategory: config.imagePromptCategory,
        imageEditSourceId: config.imageEditSourceId,
      },
    } as any);

    if (error) { console.error('createPendingImage failed:', error.message); return false; }
    return true;
  } catch (e: any) {
    console.error('createPendingImage error:', e.message);
    return false;
  }
};

/**
 * Used after we receive the fal.ai request_id back from the submit call so
 * a future page-refresh can resume polling.
 */
export const setImageTaskInfo = async (
  id: string,
  requestId: string,
  endpoint: string,
  promptContext: Pick<GeneratedMedia, 'originalPrompt' | 'imagePromptCategory' | 'imageEditSourceId' | 'promptPreparation' | 'youtubeSource'> = {},
): Promise<void> => {
  if (!supabase) return;
  try {
    // Carry prompt context from the caller alongside the fal handle so
    // reload and Variation retain thumbnail rules without a read round trip.
    // (The previous SELECT also caused a noisy
    // "406 Not Acceptable" whenever 10 batch generations raced ahead of
    // their own pending-row inserts.)
    await supabase
      .from('generations')
      .update({
        metadata: { ...promptContext, falRequestId: requestId, falEndpoint: endpoint },
        status: 'processing',
      })
      .eq('id', id);
  } catch (e: any) {
    console.warn('setImageTaskInfo error:', e.message);
  }
};

/**
 * Mirror of updateVideoStatus for the image flow. Used when an image
 * generation completes or fails so the durable state is persisted.
 */
export const updateImageStatus = async (
  id: string,
  status: 'processing' | 'completed' | 'failed',
  updates?: { url?: string; metadata?: any; storagePath?: string }
): Promise<void> => {
  if (!supabase) return;
  try {
    const updateObj: any = { status };
    if (updates?.url) {
      updateObj.url = persistMediaReference(updates.url);
      const storagePath = extractStoragePathFromUrl(updates.url);
      if (storagePath) updateObj.storage_path = storagePath;
    }
    if (updates?.storagePath) updateObj.storage_path = updates.storagePath;
    if (updates?.metadata) {
      const { data: existing, error } = await supabase.from('generations').select('metadata').eq('id', id).single();
      if (error) throw new Error(`Could not preserve the saved image details: ${error.message}`);
      const merged = { ...(existing?.metadata || {}), ...updates.metadata };
      if (status === 'completed') {
        delete merged.error;
        delete merged.pollingWarning;
      }
      updateObj.metadata = merged;
    }
    await supabase.from('generations').update(updateObj).eq('id', id);
  } catch (e: any) {
    console.warn('updateImageStatus error:', e.message);
  }
};

export const updateVideoStatus = async (
  id: string,
  status: 'processing' | 'completed' | 'failed',
  updates?: { url?: string; metadata?: any; referenceImages?: GeneratedMedia['referenceImages'] }
): Promise<void> => {
  if (!supabase) return;
  try {
    const updateObj: any = { status };
    if(updates?.referenceImages)updateObj.reference_images=updates.referenceImages.map(ref=>withoutLegacyMask({...ref,data:persistMediaReference(ref.data)}));
    if (updates?.url) {
      updateObj.url = persistMediaReference(updates.url);
      const storagePath = extractStoragePathFromUrl(updates.url);
      if (storagePath) updateObj.storage_path = storagePath;
    }
    if (updates?.metadata) {
      const { data: existing } = await supabase.from('generations').select('metadata').eq('id', id).single();
      const merged = mergeVideoMetadata(existing?.metadata || {}, updates.metadata);
      if (status === 'completed') {
        delete merged.error;
        delete merged.pollingWarning;
      }
      updateObj.metadata = merged;
    }
    await supabase.from('generations').update(updateObj).eq('id', id);
  } catch (e: any) {
    console.warn('updateVideoStatus error:', e.message);
  }
};

export const deleteImage = async (media: GeneratedMedia): Promise<void> => {
  if (supabase) {
    const userId = await bindMediaSession();
    if (!userId) throw new Error('Not authenticated');
    // Delete storage files (best-effort - files may already be gone)
    try {
      const storagePath = media.storagePath || `${userId}/${getOriginalStoragePath(media.id)}`;
      const thumbnailPath = media.thumbnailPath || `${userId}/${getThumbnailStoragePath(media.id)}`;
      const pathsToRemove = [storagePath, thumbnailPath];

      // Inputs can be shared by a batch, another saved result, or the open
      // composer. Deleting an output must never delete its reference files.

      await supabase.storage.from(MEDIA_BUCKET_NAME).remove(pathsToRemove);
    } catch (e) {
      // Non-fatal: storage files may not exist
    }

    // Delete DB row — if this fails, queue for retry so the image stays hidden
    try {
      const { error: dbError } = await supabase.from('generations').delete().eq('id', media.id);
      if (dbError) {
        console.error(`DB delete failed for ${media.id}, queuing for retry:`, dbError.message);
        addPendingDeletion(media.id);
      } else {
        removePendingDeletion(media.id);
      }
    } catch (e) {
      console.error(`DB delete error for ${media.id}, queuing for retry:`, e);
      addPendingDeletion(media.id);
    }
  }

  await deleteImagesFromIndexedDb([media.id]);
};

export const deleteImages = async (medias: GeneratedMedia[]): Promise<void> => {
  if (medias.length === 0) return;
  await Promise.allSettled(medias.map((media) => deleteImage(media)));
};

export const toggleFavorite = async (id: string, isFavorite: boolean): Promise<void> => {
  if (supabase) {
    const { error } = await supabase.from('generations').update({ is_favorite: isFavorite }).eq('id', id);
    if (error) throw new Error(`Favorite could not be saved: ${error.message}`);
  }
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.get(id);
    req.onsuccess = () => {
      const img = req.result as GeneratedMedia;
      if (img) {
        img.isFavorite = isFavorite;
        store.put(img);
      }
    };
  } catch (e) { }
};

export const getImageById = async (id: string, userId?: string | null, options?: { requireRemote?: boolean }): Promise<GeneratedMedia | null> => {
  const operationUserId = await bindMediaSession();
  if (supabase && !operationUserId) return null;
  if (supabase) {
    try {
      const resolvedUserId = userId || operationUserId;
      if (!resolvedUserId) return null;

      const data = await retryTransientRead(async () => {
        const result = await supabase.from('generations').select('*').eq('id', id).eq('user_id', resolvedUserId).maybeSingle();
        if (result.error) throw result.error;
        return result.data;
      });
      if (data) {
        // Queued/running rows have no output to sign. Avoid signing every
        // reference on every three-second status poll in a large batch.
        if (!options?.requireRemote || data.status === 'completed') await hydrateMediaRows([data]);
        if (await bindMediaSession() !== operationUserId) return null;
        return mapRowToMedia(data);
      }
      if (options?.requireRemote) return null;
    } catch (e) {
      if (options?.requireRemote) throw e;
      console.warn(`Supabase fetch specific image ${id} failed:`, e);
      // Cross-user admin reads must never fall back to the signed-in user's
      // local IndexedDB cache.
      if (userId) return null;
    }
  }

  try {
    const db = await openDB(operationUserId);
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(id);
      request.onsuccess = () => resolve(request.result as GeneratedMedia || null);
      request.onerror = () => reject(request.error);
    });
  } catch (e) {
    return null;
  }
};

export const getImages = async (
  onProgress?: (media: GeneratedMedia[]) => void,
  onLoadError?: (error: Error) => void,
): Promise<GeneratedMedia[]> => {
  const operationUserId = await bindMediaSession();
  if (supabase && !operationUserId) return [];
  const localImages = await readImagesFromIndexedDb();
  const pendingLocalImages = getPendingLocalImages(localImages);

  // Retry any previously-failed deletions before fetching
  await retryPendingDeletions();
  const pendingDeletions = getPendingDeletions();

  let latestRemoteImages: GeneratedMedia[] = [];
  if (supabase) {
    try {
      const userId = await bindMediaSession();
      if (!userId || userId !== operationUserId) return [];
      const mapVisibleRemoteRows = (rows: any[]) => rows
        .map(mapRowToMedia)
        .filter(img => (img.url && img.url.trim() !== '') || img.status === 'pending' || img.status === 'processing' || img.status === 'failed')
        .filter(img => !pendingDeletions.has(img.id));

      const data = await selectGenerationRowsForUser(userId, async (rows) => {
        await hydrateMediaRows(rows);
        if (await bindMediaSession() !== operationUserId) throw new Error('Media session changed');
        latestRemoteImages = mapVisibleRemoteRows(rows);
        onProgress?.(mergeMediaCollections(latestRemoteImages, pendingLocalImages));
      });

      if (await bindMediaSession() !== operationUserId) return [];
      const remoteImages = mapVisibleRemoteRows(data);
      return mergeMediaCollections(remoteImages, pendingLocalImages);
    } catch (e: any) {
      console.warn("Supabase fetch failed, falling back to IndexedDB merge", e);
      if (await bindMediaSession() !== operationUserId) return [];
      onLoadError?.(new Error('Some generations could not be loaded. Reload the gallery to retry.'));
      return mergeMediaCollections(latestRemoteImages, pendingLocalImages);
    }
  }

  return mergeMediaCollections([], pendingLocalImages);
};

/**
 * Admin gallery read path. It is intentionally remote-only and explicitly
 * scoped to one user so another user's rows can never be mixed with the
 * signed-in admin's IndexedDB cache.
 */
export const getImagesForUser = async (userId: string): Promise<GeneratedMedia[]> => {
  if (!supabase) throw new Error('Cloud storage is unavailable.');
  if (!userId) throw new Error('A user is required to load an admin gallery.');

  const operationUserId = await bindMediaSession();
  if (!operationUserId) throw new Error('Not authenticated');
  const data = await selectGenerationRowsForUser(userId);
  await hydrateMediaRows(data);
  if (await bindMediaSession() !== operationUserId) return [];
  return data
    .map(mapRowToMedia)
    .filter(img => (img.url && img.url.trim() !== '') || img.status === 'pending' || img.status === 'processing' || img.status === 'failed');
};

export const clearImages = async (): Promise<void> => {
  if (supabase) {
    const userId = await bindMediaSession();
    if (!userId) throw new Error('Not authenticated');
    const { data: rows, error: selectError } = await selectPagedGenerationRows(
      userId, 'id, created_at, storage_path, thumbnail_path, url, type',
    );
    if (selectError) {
      throw new Error(`DB list before clear failed: ${selectError.message}`);
    }

    // Read the complete snapshot before deleting. Bound each storage request
    // to 1,000 paths and avoid a single oversized ID filter for large galleries.
    for (let offset = 0; rows && offset < rows.length; offset += 500) {
      const batch = rows.slice(offset, offset + 500);
      const ids = batch.map((r: any) => r.id);
      const filenames = batch.map((row: any) => row.storage_path || extractStoragePathFromUrl(row.url) || `${userId}/${row.id}.${row.type === 'video' ? 'mp4' : ORIGINAL_EXTENSION}`);
      const thumbFilenames = batch.map((row: any) => row.thumbnail_path || `${userId}/${getThumbnailStoragePath(row.id)}`);
      const { error: storageError } = await supabase.storage.from(MEDIA_BUCKET_NAME).remove([...filenames, ...thumbFilenames]);
      if (storageError) {
        console.warn("Storage clear failed (some files may already be gone):", storageError);
      }

      const { error: deleteError } = await supabase.from('generations').delete().eq('user_id', userId).in('id', ids);
      if (deleteError) {
        throw new Error(`DB clear failed: ${deleteError.message}`);
      }
    }
  }

  // Clear pending deletions queue along with images
  if (mediaSessionUserId) localStorage.removeItem(`${PENDING_DELETIONS_KEY}:${mediaSessionUserId}`);
  await clearImagesFromIndexedDb();
};

export const syncLocalImages = async (): Promise<void> => {
  if (!supabase) return;
  try {
    const operationUserId = await bindMediaSession();
    if (!operationUserId) return;
    const db = await openDB(operationUserId);
    const keys = await new Promise<string[]>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).getAllKeys();
      req.onsuccess = () => resolve(req.result as string[]);
      req.onerror = () => reject(req.error);
    });

    for (const key of keys) {
      const media = await new Promise<GeneratedMedia | null>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const req = tx.objectStore(STORE_NAME).get(key);
        req.onsuccess = () => resolve(req.result as GeneratedMedia);
        req.onerror = () => reject(req.error);
      });
      
      if (media && media.syncStatus === 'local-only') {
        console.log(`Syncing local-only image ${media.id} to Supabase...`);
        try {
          await saveImage(media, operationUserId);
          console.log(`Successfully synced image ${media.id}`);
        } catch (e) {
          console.error(`Failed to sync image ${media.id}:`, e);
        }
      }
    }
  } catch (e) {
    console.error("Error during background sync:", e);
  }
};

// --- Folder Methods ---

export const saveFolder = async (folder: Folder): Promise<void> => {
  const operationUserId = await bindMediaSession();
  if (supabase && !operationUserId) throw new Error('Sign in to create a folder.');
  if (supabase) {
    const { error } = await supabase.from('folders').insert({
      id: folder.id,
      user_id: operationUserId,
      name: folder.name,
      created_at: folder.createdAt,
      parent_id: folder.parentId || null
    });
    if (error) throw new Error(`Folder could not be created: ${error.message}`);
  }

  try {
    const db = await openDB(operationUserId);
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(FOLDER_STORE_NAME, 'readwrite');
      tx.objectStore(FOLDER_STORE_NAME).put(folder);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('Local folder save failed'));
      tx.onabort = () => reject(tx.error || new Error('Local folder save was aborted'));
    });
  } catch (error) {
    if (!supabase) throw error;
    console.warn('Folder saved, but local cache could not be updated:', error);
  }
};

export const getFolders = async (userId?: string | null): Promise<Folder[]> => {
  if (!supabase) return [];
  const sessionUser = await getCurrentUserId();
  if (!sessionUser) return [];
  const resolvedUserId = userId || sessionUser;
  const folders: Folder[] = [];
  let cursor: string | null = null;
  while (true) {
    const query = supabase.from('folders').select('id,name,created_at,parent_id')
      .eq('user_id', resolvedUserId).order('id', { ascending: true }).limit(500);
    if (cursor) query.gt('id', cursor);
    const { data, error } = await query;
    if (await getCurrentUserId() !== sessionUser) throw new Error('The gallery account changed.');
    if (error) throw error;
    if (!data?.length) break;
    folders.push(...data.map((d: any) => ({ id: d.id, name: d.name, createdAt: d.created_at, parentId: d.parent_id })));
    const nextCursor = data[data.length - 1].id;
    if (!nextCursor || cursor === nextCursor) throw new Error('Folders could not be fully loaded.');
    cursor = nextCursor;
  }
  return folders.sort((a, b) => b.createdAt - a.createdAt);
};

export const renameFolder = async (folderId: string, newName: string): Promise<void> => {
  if (supabase) {
    await supabase.from('folders').update({ name: newName }).eq('id', folderId);
  }
  try {
    const db = await openDB();
    const tx = db.transaction(FOLDER_STORE_NAME, 'readwrite');
    const store = tx.objectStore(FOLDER_STORE_NAME);
    const req = store.get(folderId);
    req.onsuccess = () => {
      const folder = req.result as Folder;
      if (folder) {
        folder.name = newName;
        store.put(folder);
      }
    };
  } catch (e) { }
};

export interface DeleteFolderResult {
  folderIds: string[];
  mediaIds: string[];
}

/** Folder media rows that a failed delete left in place; they still exist. */
export class FolderDeleteError extends Error {
  constructor(message: string, readonly keptMediaIds: string[]) { super(message); }
}

export const deleteFolder = async (folderId: string, onMediaIds?: (ids: string[], folderIds: string[]) => void): Promise<DeleteFolderResult> => {
  const folderRelations: Array<{ id: string; parentId: string | null }> = [];
  let localFolders: Folder[] = [];
  let localMedia: GeneratedMedia[] = [];

  // Local-only generations and folders must follow the same recursive delete
  // semantics as cloud-backed rows.
  try {
    const db = await openDB();
    const tx = db.transaction([FOLDER_STORE_NAME, STORE_NAME], 'readonly');
    const [storedFolders, storedMedia] = await Promise.all([
      new Promise<Folder[]>((resolve, reject) => {
        const request = tx.objectStore(FOLDER_STORE_NAME).getAll();
        request.onsuccess = () => resolve(request.result as Folder[]);
        request.onerror = () => reject(request.error);
      }),
      new Promise<GeneratedMedia[]>((resolve, reject) => {
        const request = tx.objectStore(STORE_NAME).getAll();
        request.onsuccess = () => resolve(request.result as GeneratedMedia[]);
        request.onerror = () => reject(request.error);
      }),
    ]);
    localFolders = storedFolders;
    localMedia = storedMedia;
    folderRelations.push(...storedFolders.map(folder => ({ id: folder.id, parentId: folder.parentId || null })));
  } catch (error) {
    console.warn('Could not inspect local folder contents before delete:', error);
  }

  let userId: string | null = null;
  if (supabase) {
    userId = await getCurrentUserId();
    if (!userId) throw new Error('Not authenticated');

    const { data: cloudFolders, error: folderReadError } = await supabase
      .from('folders')
      .select('id, parent_id')
      .eq('user_id', userId);
    if (folderReadError) throw new Error(`Folder tree could not be read: ${folderReadError.message}`);
    folderRelations.push(...(cloudFolders || []).map((folder: any) => ({
      id: folder.id,
      parentId: folder.parent_id || null,
    })));
  }

  const folderIds = new Set<string>([folderId]);
  let foundDescendant = true;
  while (foundDescendant) {
    foundDescendant = false;
    for (const folder of folderRelations) {
      if (folder.parentId && folderIds.has(folder.parentId) && !folderIds.has(folder.id)) {
        folderIds.add(folder.id);
        foundDescendant = true;
      }
    }
  }

  const mediaIds = new Set<string>();
  const storagePaths = new Set<string>();
  for (const media of localMedia) {
    if (!media.folderId || !folderIds.has(media.folderId)) continue;
    mediaIds.add(media.id);
    storagePaths.add(media.storagePath || (media.mediaType === 'video' ? `${media.id}.mp4` : getOriginalStoragePath(media.id)));
    storagePaths.add(media.thumbnailPath || getThumbnailStoragePath(media.id));
    for (const ref of media.referenceImages || []) {
      storagePaths.add(`refs/${media.id}_${ref.id}.jpg`);
    }
  }

  const chunk = <T,>(values: T[], size = 100): T[][] => {
    const chunks: T[][] = [];
    for (let index = 0; index < values.length; index += size) chunks.push(values.slice(index, index + size));
    return chunks;
  };

  if (supabase && userId) {
    for (const ids of chunk(Array.from(folderIds))) {
      const { data: rows, error: mediaReadError } = await supabase
        .from('generations')
        .select('id, type, url, storage_path, thumbnail_path, reference_images')
        .eq('user_id', userId)
        .in('folder_id', ids);
      if (mediaReadError) throw new Error(`Folder contents could not be read: ${mediaReadError.message}`);

      for (const row of rows || []) {
        mediaIds.add(row.id);
        const originalPath = row.storage_path
          || extractStoragePathFromUrl(row.url)
          || (row.type === 'video' ? `${row.id}.mp4` : getOriginalStoragePath(row.id));
        storagePaths.add(originalPath);
        storagePaths.add(row.thumbnail_path || getThumbnailStoragePath(row.id));
        for (const ref of Array.isArray(row.reference_images) ? row.reference_images : []) {
          if (ref?.id) storagePaths.add(`refs/${row.id}_${ref.id}.jpg`);
        }
      }
    }
  }

  // The caller marks these as deleted before any row goes, so a job that
  // finishes during the delete cannot save one of them again.
  onMediaIds?.(Array.from(mediaIds), Array.from(folderIds));

  if (supabase && userId) {
    // Delete media before folders so no foreign-key action can move content
    // back to the parent/root folder.
    const mediaChunks = chunk(Array.from(mediaIds));
    for (const [index, ids] of mediaChunks.entries()) {
      const { error } = await supabase
        .from('generations')
        .delete()
        .eq('user_id', userId)
        .in('id', ids);
      if (error) throw new FolderDeleteError(`Folder media could not be deleted: ${error.message}`, mediaChunks.slice(index).flat());
      ids.forEach(removePendingDeletion);
    }

    const parentById = new Map(folderRelations.map(folder => [folder.id, folder.parentId]));
    const depth = (id: string): number => {
      let value = 0;
      let parentId = parentById.get(id) || null;
      const visited = new Set<string>([id]);
      while (parentId && folderIds.has(parentId) && !visited.has(parentId)) {
        visited.add(parentId);
        value += 1;
        parentId = parentById.get(parentId) || null;
      }
      return value;
    };

    const deepestFirst = Array.from(folderIds).sort((a, b) => depth(b) - depth(a));
    for (const id of deepestFirst) {
      const { error } = await supabase
        .from('folders')
        .delete()
        .eq('user_id', userId)
        .eq('id', id);
      if (error) throw new Error(`Folder could not be deleted: ${error.message}`);
    }

    // Storage cleanup is best-effort: database state is authoritative and an
    // orphaned blob is preferable to a visible broken generation record.
    for (const paths of chunk(Array.from(storagePaths))) {
      try {
        await supabase.storage.from(MEDIA_BUCKET_NAME).remove(paths);
      } catch (error) {
        console.warn('Folder storage cleanup failed:', error);
      }
    }
  }

  await deleteImagesFromIndexedDb(Array.from(mediaIds));
  try {
    const db = await openDB();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(FOLDER_STORE_NAME, 'readwrite');
      const store = tx.objectStore(FOLDER_STORE_NAME);
      folderIds.forEach(id => store.delete(id));
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch (error) {
    console.warn('Local folder cleanup failed:', error);
  }

  return {
    folderIds: Array.from(folderIds),
    mediaIds: Array.from(mediaIds),
  };
};

export const moveImagesToFolder = async (imageIds: string[], folderId: string | null): Promise<void> => {
  const uniqueIds = Array.from(new Set(imageIds));
  if (uniqueIds.length === 0) return;

  if (supabase) {
    const userId = await getCurrentUserId();
    if (!userId) throw new Error('Not authenticated');
    const { error } = await supabase.from('generations')
      .update({ folder_id: folderId })
      .eq('user_id', userId)
      .in('id', uniqueIds);
    if (error) throw new Error(`Media could not be moved: ${error.message}`);
  }

  // Persist the cache only after the authoritative cloud write succeeds. A
  // rejected cloud move must leave both the selection and cached folders intact.
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);

      uniqueIds.forEach(id => {
        const req = store.get(id);
        req.onsuccess = () => {
          const img = req.result as GeneratedMedia;
          if (img) {
            img.folderId = folderId;
            store.put(img);
          }
        };
      });

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('Local media move failed'));
      tx.onabort = () => reject(tx.error || new Error('Local media move was aborted'));
    });
  } catch (error) {
    // A cache failure cannot roll back an already committed cloud move. Without
    // a cloud backend, IndexedDB is authoritative and the caller must roll back.
    if (!supabase) throw error;
    console.warn('Media moved in cloud, but local cache could not be updated:', error);
  }
};

export const moveFolderToFolder = async (folderId: string, targetParentId: string | null): Promise<void> => {
  // Basic protection against self-nesting
  if (folderId === targetParentId) return;

  if (supabase) {
    const userId = await getCurrentUserId();
    if (!userId) throw new Error('Not authenticated');
    const { error } = await supabase.from('folders')
      .update({ parent_id: targetParentId })
      .eq('id', folderId)
      .eq('user_id', userId);
    if (error) throw new Error(`Folder could not be moved: ${error.message}`);
  }

  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(FOLDER_STORE_NAME, 'readwrite');
      const store = tx.objectStore(FOLDER_STORE_NAME);
      const req = store.get(folderId);
      req.onsuccess = () => {
        const folder = req.result as Folder;
        if (folder) {
          folder.parentId = targetParentId;
          store.put(folder);
        }
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('Local folder move failed'));
      tx.onabort = () => reject(tx.error || new Error('Local folder move was aborted'));
    });
  } catch (error) {
    if (!supabase) throw error;
    console.warn('Folder moved in cloud, but local cache could not be updated:', error);
  }
};

// --- Template Methods ---

export const saveTemplate = async (template: Template): Promise<Template> => {
  template = { ...template, config: { ...template.config, referenceImages: template.config.referenceImages?.map(withoutLegacyMask) } };
  const operationUserId = await bindMediaSession();
  if (supabase && !operationUserId) throw new Error('Sign in to save a reference.');
  const uploadPaths: string[] = [];
  let templateWriteStarted = false;
  try {
    // Prepare sequentially so rollback never races a still-running upload.
    const referenceAudios: ReferenceAudio[] = [];
    for (const reference of template.config.referenceAudios || []) {
      if (!reference.url.startsWith('blob:')) { referenceAudios.push(reference); continue; }
      const response = await fetch(reference.url);
      if (!response.ok) throw new Error('Template audio could not be read. Attach the clip again.');
      const blob = await response.blob();
      if (!blob.size) throw new Error('Template audio is empty. Attach the clip again.');
      if (await bindMediaSession() !== operationUserId) throw new Error('The template account changed.');
      const url = await uploadBlobToPublicUrl(blob, reference.mimeType || blob.type, 'template_audio', 'bin', {
        expectedUserId: operationUserId || undefined,
        onUploadPath: path => uploadPaths.push(path),
      });
      if (await bindMediaSession() !== operationUserId) throw new Error('The template account changed.');
      if (!url) throw new Error('Template audio could not be uploaded. Your draft is unchanged; try again.');
      referenceAudios.push({ ...reference, url: persistMediaReference(url)! });
    }
    if (template.config.referenceAudios) template = { ...template, config: { ...template.config, referenceAudios } };

    if (supabase) {
      templateWriteStarted = true;
      const { error } = await supabase.from('templates').upsert({
        id: template.id,
        user_id: operationUserId,
        name: template.name,
        config: template.config,
        created_at: template.createdAt
      });
      if (error) {
        // A lost acknowledgement may hide a committed template. Only an
        // known transaction-rejection classes prove its inputs are safe to
        // remove. Connection errors (08) and transport codes stay ambiguous.
        if (/^(?:22|23|28|40|42|44)[0-9A-Z]{3}$/.test(error.code || '')) templateWriteStarted = false;
        throw new Error(`Template could not be saved: ${error.message}`);
      }
    }

    try {
      const db = await openDB(operationUserId);
      const tx = db.transaction(TEMPLATE_STORE_NAME, 'readwrite');
      tx.objectStore(TEMPLATE_STORE_NAME).put(template);
    } catch (error) { }
    return template;
  } catch (error) {
    if (!templateWriteStarted && uploadPaths.length) {
      try {
        if (await bindMediaSession() !== operationUserId) {
          console.warn('Uncommitted template audio retained because the account changed.');
        } else {
          const { error: cleanupError } = await supabase.storage.from(MEDIA_BUCKET_NAME).remove(uploadPaths);
          if (cleanupError) console.warn('Uncommitted template audio could not be removed.');
        }
      } catch { console.warn('Uncommitted template audio could not be removed.'); }
    }
    throw error;
  }
};

export const getTemplates = async (): Promise<Template[]> => {
  if (supabase) {
    try {
      const userId = await getCurrentUserId();
      if (!userId) return [];
      const { data, error } = await supabase.from('templates').select('*').eq('user_id', userId).order('created_at', { ascending: false });
      // A failed read is not "no templates".
      if (error) throw new Error(`Templates could not be loaded: ${error.message}`);
      if (data) {
        return data.map((row: any) => ({
          id: row.id, name: row.name, config: { ...row.config, referenceImages: row.config?.referenceImages?.map(withoutLegacyMask) }, createdAt: row.created_at
        }));
      }
      return [];
    } catch (e) {
      // Signed out is "no templates"; any other failure is reported.
      if (isAuthSessionMissingError(e)) return [];
      throw e instanceof Error ? e : new Error('Templates could not be loaded.');
    }
  }
  return [];
};

export const deleteTemplate = async (id: string): Promise<void> => {
  if (supabase) await supabase.from('templates').delete().eq('id', id);
  try {
    const db = await openDB();
    db.transaction(TEMPLATE_STORE_NAME, 'readwrite').objectStore(TEMPLATE_STORE_NAME).delete(id);
  } catch (error) { }
};

// --- Reference Gallery Methods ---

export const saveReferenceImage = async (image: SavedReferenceImage, existingReferences: readonly SavedReferenceImage[] = []): Promise<SavedReferenceImage> => {
  if (image.canEdit === false) throw new Error('Only the owner can edit this saved reference.');
  const operationUserId = await bindMediaSession();
  if (supabase && !operationUserId) throw new Error('Sign in to save a reference.');
  if (supabase) {
    try {
      const userId = operationUserId;
      if (!userId) throw new Error('Not authenticated');

      // Saved inputs outlive their source gallery items and temporary URLs,
      // whether private or shared. Keep the caller's creative draft untouched.
      if (!image.data.startsWith('data:image/')) image = { ...image, data: await snapshotSavedReference(image.data) };
      await requirePeopleSession(userId);
      // Creation callers compare the prepared bytes with their visible library.
      const existing = existingReferences.find(reference => reference.canEdit === true && reference.data === image.data);
      if (existing) {
        const { data: saved, error } = await supabase.from('reference_images').select('id,data')
          .eq('id', existing.id).eq('user_id', userId).maybeSingle();
        if (error) throw new Error('The saved reference could not be checked.', { cause: error });
        await requirePeopleSession(userId);
        if (saved?.data === image.data) return existing;
      }
      const { error } = await supabase.from('reference_images').upsert({
        id: image.id,
        user_id: userId,
        data: persistMediaReference(image.data),
        is_shared: image.isShared === true,
        mime_type: image.mimeType,
        name: image.name || null,
        created_at: image.createdAt
      });

      if (error) throw new Error(`DB insert failed: ${error.message}`);
      await requirePeopleSession(userId);
    } catch (e) {
      throw new Error('Reference could not be saved. Your changes are still here; please retry.', { cause: e });
    }
  }

  // Shared library access must be rechecked against RLS, never cached offline.
  if (supabase) return { ...image, canEdit: true };
  if (image.isShared) throw new Error('Sign in to share a saved reference.');
  try {
    const db = await openDB(operationUserId);
    const tx = db.transaction(REF_GALLERY_STORE_NAME, 'readwrite');
    tx.objectStore(REF_GALLERY_STORE_NAME).put({ ...image, data: persistMediaReference(image.data) });
  } catch (error) {
    console.error('Failed to save reference image to IDB:', error);
  }
  return image;
};

export const getReferenceGallery = async (): Promise<SavedReferenceImage[]> => {
  if (supabase) {
    let userId: string | null = null;
    try {
      userId = await getCurrentUserId();
      if (!userId) return [];
      const data = await readSavedLibraryPages<any>(offset => supabase
        .from('reference_images').select('*')
        .or(`user_id.eq.${userId},is_shared.eq.true`)
        .order('created_at', { ascending: false }).order('id', { ascending: true })
        .range(offset, offset + 249), userId, 'Saved references could not be loaded.');

      if (data && data.length > 0) {
        await signMediaPaths(data.map(row => extractStoragePathFromUrl(row.data)));
        await requirePeopleSession(userId);
        return data.map((row: any) => ({
          id: row.id,
          data: resolveMediaReference(row.data) || '',
          mimeType: row.mime_type,
          name: row.name,
          createdAt: row.created_at,
          isShared: row.is_shared === true,
          canEdit: row.user_id === userId,
        }));
      }
      return [];
    } catch (error) {
      console.error('Supabase get reference gallery failed:', error);
      // Signed out, or a confirmed different user, shows an empty library. Any
      // other failure (including a failed identity lookup) is not "no saved
      // references" and must reach the caller.
      if (isAuthSessionMissingError(error)) return [];
      if (userId) {
        const currentUserId = await getCurrentUserId().catch(currentError => isAuthSessionMissingError(currentError) ? null : userId);
        if (currentUserId !== userId) return [];
      }
      throw new Error('Saved references could not be loaded. Close and reopen Saved References to retry.');
    }
  }

  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const req = db.transaction(REF_GALLERY_STORE_NAME, 'readonly')
        .objectStore(REF_GALLERY_STORE_NAME)
        .getAll();
      req.onsuccess = () => {
        const images = req.result as SavedReferenceImage[];
        resolve(images.sort((a, b) => b.createdAt - a.createdAt));
      };
      req.onerror = () => resolve([]);
    });
  } catch (error) {
    console.error('Failed to get reference gallery from IDB:', error);
    return [];
  }
};

export const deleteReferenceImage = async (id: string): Promise<void> => {
  if (supabase) {
    try {
      const userId = await requirePeopleSession();
      const { data, error } = await supabase.from('reference_images').delete().eq('id', id).eq('user_id', userId).select('id');
      if (error || !data?.length) throw new Error('Only the owner can remove this saved reference.');
      await requirePeopleSession(userId);
    } catch (error) {
      throw error;
    }
  }

  try {
    const db = await openDB();
    db.transaction(REF_GALLERY_STORE_NAME, 'readwrite')
      .objectStore(REF_GALLERY_STORE_NAME)
      .delete(id);
  } catch (error) {
    console.error('Failed to delete reference image from IDB:', error);
  }
};

const snapshotSavedReference = async (url: string): Promise<string> => {
  const response = await fetch(await refreshMediaAccessUrl(url, false));
  if (!response.ok) throw new Error('The reference image could not be loaded.');
  const blob = await response.blob();
  if (!blob.type.startsWith('image/') || blob.size > 20 * 1024 * 1024) throw new Error('Use an image smaller than 20 MB.');
  return new Promise((resolve, reject) => {
    const reader = new FileReader(); reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('The reference image could not be read.')); reader.readAsDataURL(blob);
  });
};

// Saved people deliberately have no offline fallback: a failed cloud write must
// remain visible, and a different session must never receive the old owner's data.
const savedPersonFromRow = (row: any, userId: string): SavedPerson => ({
  id: row.id, name: row.name, photos: row.photos, isMe: row.is_me,
  createdAt: row.created_at, updatedAt: row.updated_at,
  isShared: row.is_shared === true, canEdit: row.user_id === userId,
});
const requirePeopleSession = async (expected?: string): Promise<string> => {
  const id = await getCurrentUserId();
  if (!id || (expected && expected !== id)) throw new Error('Your session changed. Reopen Saved References and try again.');
  return id;
};
const rememberSavedPersonCover = (userId: string, person: SavedPerson) => {
  const cover = person.photos[0]?.data;
  if (cover) savedPersonCovers.set(`${userId}:${person.id}`, { updatedAt: person.updatedAt, cover });
  else savedPersonCovers.delete(`${userId}:${person.id}`);
};
// Mobile connections can stall without ever failing, so every read is bounded.
const withPeopleDeadline = async <T>(milliseconds: number, message: string, signal: AbortSignal | undefined, work: (signal: AbortSignal) => Promise<T>): Promise<T> => {
  const task = createTaskDeadline(milliseconds, signal, message);
  try {
    task.signal.throwIfAborted();
    return await waitForTask(work(task.signal), task.signal);
  } finally { task.dispose(); }
};

/** A short page may be a server row cap. Read to exhaustion and recheck the
 * initiating account before exposing any library rows or caching photos. */
const readSavedLibraryPages = async <T>(
  readPage: (offset: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
  userId: string,
  message: string,
  signal?: AbortSignal,
): Promise<T[]> => {
  const rows: T[] = [];
  while (true) {
    signal?.throwIfAborted();
    await requirePeopleSession(userId);
    const { data, error } = await readPage(rows.length);
    signal?.throwIfAborted();
    if (error) throw new Error(message, { cause: error });
    await requirePeopleSession(userId);
    if (!data?.length) return rows;
    rows.push(...data);
  }
};

/** Card details only: one person's photos can total many megabytes. */
export const getSavedPeople = (signal?: AbortSignal): Promise<SavedPersonSummary[]> =>
  withPeopleDeadline(20_000, 'Saved people are taking too long to load. Check your connection and retry.', signal, async deadline => {
    const userId = await requirePeopleSession();
    const data = await readSavedLibraryPages<any>(offset => supabase.from('saved_people').select('id,user_id,name,is_me,is_shared,created_at,updated_at')
      .or(`user_id.eq.${userId},is_shared.eq.true`).is('deleted_at', null)
      .order('created_at', { ascending: false }).order('id', { ascending: true })
      .range(offset, offset + 249).abortSignal(deadline), userId, 'Saved people could not be loaded. Please retry.', deadline);
    return (data || []).map((row: any) => ({ id: row.id, name: row.name, isMe: row.is_me, isShared: row.is_shared === true, canEdit: row.user_id === userId, createdAt: row.created_at, updatedAt: row.updated_at }));
  });

/** First photo of each card, downloaded once per saved version. */
export const getSavedPeopleCovers = (people: SavedPersonSummary[], signal?: AbortSignal): Promise<Record<string, string>> =>
  withPeopleDeadline(60_000, 'Saved people photos are taking too long to load.', signal, async deadline => {
    const userId = await requirePeopleSession();
    const covers: Record<string, string> = {};
    const missing: string[] = [];
    for (const person of people) {
      const cached = savedPersonCovers.get(`${userId}:${person.id}`);
      if (cached?.updatedAt === person.updatedAt) covers[person.id] = cached.cover;
      else missing.push(person.id);
    }
    if (!missing.length) return covers;
    const data = await readSavedLibraryPages<any>(offset => supabase.from('saved_people').select('id,updated_at,cover:photos->0')
      .or(`user_id.eq.${userId},is_shared.eq.true`).is('deleted_at', null).in('id', missing)
      .order('id', { ascending: true }).range(offset, offset + 249).abortSignal(deadline), userId, 'Saved people photos could not be loaded.', deadline);
    for (const row of (data || []) as any[]) {
      if (typeof row.cover?.data !== 'string') continue;
      savedPersonCovers.set(`${userId}:${row.id}`, { updatedAt: row.updated_at, cover: row.cover.data });
      covers[row.id] = row.cover.data;
    }
    return covers;
  });

/** The complete photo set, loaded only to add or edit this person. */
export const getSavedPerson = (id: string, signal?: AbortSignal): Promise<SavedPerson> =>
  withPeopleDeadline(60_000, 'This person’s photos are taking too long to load. Check your connection and retry.', signal, async deadline => {
    const userId = await requirePeopleSession();
    const { data, error } = await supabase.from('saved_people').select('*').eq('id', id).or(`user_id.eq.${userId},is_shared.eq.true`)
      .is('deleted_at', null).abortSignal(deadline).maybeSingle();
    if (error) throw new Error('This person could not be loaded. Please retry.');
    if (!data) throw new Error('This person is no longer saved. Reopen Saved References.');
    await requirePeopleSession(userId);
    const person = savedPersonFromRow(data, userId);
    rememberSavedPersonCover(userId, person);
    return person;
  });

export const savePerson = async (person: SavedPerson, isNew = false): Promise<SavedPerson> => {
  const userId = await requirePeopleSession();
  if (person.canEdit === false) throw new Error('Only the owner can edit this saved person.');
  const name = person.name.replace(/[\r\n\t]/g, ' ').trim().slice(0, 40);
  if (!name || !person.photos.length || person.photos.length > 16) throw new Error('Enter a name and select 1–16 photos.');
  // Make independent image snapshots; deleting a source reference later must
  // not delete a saved identity's photos or leave expiring provider URLs behind.
  const photos: SavedPerson['photos'] = [];
  for (const photo of person.photos) {
    let data = photo.data;
    if (!data.startsWith('data:image/')) {
      const response = await fetch(await refreshMediaAccessUrl(data, false));
      if (!response.ok) throw new Error('A reference photo could not be loaded. Replace it and try again.');
      const blob = await response.blob();
      data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error('A reference photo could not be read.'));
        reader.readAsDataURL(blob);
      });
    }
    if (!/^data:image\/(png|jpeg|webp);base64,/i.test(data) || estimateBase64Size(data) > 1024 * 1024) data = await compressImage(data, 1536, 0.9);
    const mimeType = data.slice(5, data.indexOf(';'));
    if (!/^image\/(png|jpeg|webp)$/.test(mimeType)) throw new Error('Use PNG, JPEG or WebP photos.');
    if (!photos.some(existing => existing.id === photo.id || existing.data === data)) photos.push({ id: photo.id, data, mimeType });
  }
  if (JSON.stringify(photos).length > 20 * 1024 * 1024) throw new Error('These photos are too large. Use fewer or smaller photos.');
  await requirePeopleSession(userId);
  const updatedAt = Math.max(Date.now(), person.updatedAt + 1);
  const row = { name, photos, is_me: person.isMe, is_shared: person.isShared === true, updated_at: updatedAt, deleted_at: null };
  const query = isNew
    ? supabase.from('saved_people').insert({ ...row, id: person.id, user_id: userId, created_at: person.createdAt })
    : supabase.from('saved_people').update(row).eq('id', person.id).eq('user_id', userId).eq('updated_at', person.updatedAt);
  const { data, error } = await query.select('*').single();
  if (error || !data) throw new Error(isNew ? 'Person could not be saved. Your changes are still here; please retry.' : 'Person could not be updated. Reopen it to check for changes from another tab.');
  await requirePeopleSession(userId);
  const saved = savedPersonFromRow(data, userId);
  rememberSavedPersonCover(userId, saved);
  return saved;
};

/** Recoverable removal, with a version returned for Undo. */
export const removeSavedPerson = async (person: SavedPerson): Promise<SavedPerson> => {
  if (person.canEdit === false) throw new Error('Only the owner can remove this saved person.');
  const userId = await requirePeopleSession();
  const updatedAt = Math.max(Date.now(), person.updatedAt + 1);
  const { data, error } = await supabase.from('saved_people').update({ deleted_at: new Date().toISOString(), updated_at: updatedAt })
    .eq('id', person.id).eq('user_id', userId).eq('updated_at', person.updatedAt).select('*').single();
  if (error || !data) throw new Error('Person could not be removed. Reopen it and try again.');
  await requirePeopleSession(userId);
  savedPersonCovers.delete(`${userId}:${person.id}`);
  return savedPersonFromRow(data, userId);
};
