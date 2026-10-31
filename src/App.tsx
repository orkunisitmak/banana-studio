import { isLocalWorkspace } from './lib/config/runtimeConfig';
import { WorkspaceBar } from './components/WorkspaceBar';
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { flushSync } from 'react-dom';
import { Controls } from './components/Controls';
import { getReferenceImageLimit } from './lib/images/imageReferences';
import { Gallery } from './components/Gallery';
import { HistoryPanel } from './components/HistoryPanel';
import { AuthBoundary } from './components/AuthBoundary';
import { startTextPreferencesSync } from './services/textPreferencesService';
import { AdminPanel } from './components/AdminPanel';
import { useToast } from './components/Toast';
import { AdminUserSummary, GenerationConfig, GeneratedMedia, Template, UserProfile, DEFAULT_IMAGE_MODEL, DEFAULT_VIDEO_MODEL, getActiveImageModel, isEnhancedPromptStale } from './types';
import { generateMedia, brainstormIdeas, generatePromptVariation, isFalImageModel } from './services/geminiService';
import * as workspaceStorage from './services/storageService';
import { resumeOpenAIImage, recoverOpenAIImage } from './services/openaiImageService';
import { getOpenAIImageOptions, getOpenAIImageSize, SUNBURST_MODEL } from './lib/images/openaiImage';
import { createBrainstormBatch, type BrainstormGenerationRequest } from './lib/brainstorm/brainstormGeneration';
import { getImageCostHistory } from './services/imageCostHistory';
import type { ImageCostSample } from './lib/images/imageCostPreview';
import { resumeGptImage2Task } from './services/falImageService';
import { createVideoTask, pollVideoTask, logVideoUsage, RecoverableVideoTaskError, isRecoverableVideoTaskError } from './services/runwayService';
import { getSeedanceFrameError } from './lib/video/seedanceFrames';
import { getSession, supabase } from './services/authService';
import { H3_MAX_CAPABILITIES } from './lib/video/h3Max';
import { getH3MaxConfigError, getH3MaxMode } from './lib/video/h3MaxConfig';
import { parseErrorMessage } from './services/generationErrors';
import { mergePersonReferenceInputs } from './lib/references/personReferences';
import { createRecreateConfig, mergeRecreateHydration } from './lib/gallery/recreateDraft';
import { validateImageGenerationReferences } from './lib/images/imagePrompting';
import { prepareProtectedImageSource, finishProtectedImageEdit } from './services/imageEditService';
import { getGalleryEditSourceId } from './lib/gallery/galleryEditJobs';
import { isStuckPendingMedia, VIDEO_SUBMISSION_HEARTBEAT_INTERVAL_MS } from './lib/gallery/stuckPending';
import { refreshPendingVideoSubmission, failStalePendingVideo, scheduleStaleVideoCheck, allowPeriodicStaleCheck } from './lib/gallery/videoSubmissionLease';
import { mergeLoadedGalleryHistory } from './lib/gallery/galleryHistoryMerge';
import { mergeReconciledGalleryCosts } from './lib/gallery/galleryBillingRefresh';
import { describeMediaCount } from './lib/gallery/deleteConfirmation';
import { createPromptPreparation } from './lib/prompts/promptPreparation';
import { resolveTextModelPreferences } from './lib/prompts/textModels';

class DeletedVideoError extends Error { constructor() { super('The video was deleted.'); } }

const resolveImageModel = (value: unknown): GenerationConfig['imageModel'] => getActiveImageModel(value);

const mergeSavedMedia = (
  media: GeneratedMedia,
  savedResult?: { publicUrl: string; thumbnailUrl?: string; storagePath: string; thumbnailPath: string }
): GeneratedMedia => {
  if (!savedResult) return media;

  return {
    ...media,
    url: savedResult.publicUrl,
    thumbnailUrl: savedResult.thumbnailUrl || media.thumbnailUrl,
    storagePath: savedResult.storagePath,
    thumbnailPath: savedResult.thumbnailPath,
  };
};

const normalizeStoredMedia = (media: GeneratedMedia): GeneratedMedia => {
  let referenceImages = media.referenceImages || [];
  const legacyImage = (media as any).referenceImage;
  const legacyMimeType = (media as any).referenceImageMimeType;

  if (legacyImage && referenceImages.length === 0) {
    referenceImages = [{
      id: 'legacy-restored',
      data: legacyImage,
      mimeType: legacyMimeType || 'image/png',
    }];
  }

  return {
    ...media,
    referenceImages,
    referenceVideos: media.referenceVideos || [],
    referenceAudios: media.referenceAudios || [],
    mediaType: media.mediaType || 'image',
    videoOperation: media.mediaType === 'video' ? (media.videoOperation || 'generate') : undefined,
    videoPromptExpansionMode: media.mediaType === 'video' ? (media.videoPromptExpansionMode || 'balanced') : undefined,
  };
};

export default function App() {
  return <AuthBoundary>{({ userId, profile }, onSignOut) => (
    <AuthorizedWorkspace key={userId} userId={userId} userProfile={profile} onSignOut={onSignOut} />
  )}</AuthBoundary>;
}

const AuthorizedWorkspace: React.FC<{
  userId: string;
  userProfile: UserProfile | null;
  onSignOut: () => Promise<void>;
}> = ({ userId, userProfile, onSignOut }) => {
  useEffect(() => startTextPreferencesSync(userId), [userId]);
  const isAuthenticated = true;
  const workspaceActive = useRef(true);
  useEffect(() => {
    workspaceActive.current = true;
    return () => { workspaceActive.current = false; };
  }, []);
  const assertWorkspaceSession = async () => {
    const session = await getSession();
    if (!workspaceActive.current || session?.user.id !== userId) throw new Error('Session changed. Sign in again to continue.');
  };
  const withWorkspaceSession = <Args extends unknown[], Result>(operation: (...args: Args) => Promise<Result>) =>
    async (...args: Args): Promise<Result> => {
      await assertWorkspaceSession();
      const result = await operation(...args);
      await assertWorkspaceSession();
      return result;
    };
  const saveImage = withWorkspaceSession((media: GeneratedMedia) => workspaceStorage.saveImage(media, userId));
  const saveVideo = withWorkspaceSession((media: GeneratedMedia) => workspaceStorage.saveVideo(media, userId));
  const getImages = withWorkspaceSession(workspaceStorage.getImages);
  const getImagesForUser = withWorkspaceSession(workspaceStorage.getImagesForUser);
  const clearImages = withWorkspaceSession(workspaceStorage.clearImages);
  const deleteImage = withWorkspaceSession(workspaceStorage.deleteImage);
  const deleteFolder = withWorkspaceSession(workspaceStorage.deleteFolder);
  const saveTemplate = withWorkspaceSession(workspaceStorage.saveTemplate);
  const getTemplates = withWorkspaceSession(workspaceStorage.getTemplates);
  const deleteTemplate = withWorkspaceSession(workspaceStorage.deleteTemplate);
  const moveImagesToFolder = withWorkspaceSession(workspaceStorage.moveImagesToFolder);
  const renameFolder = withWorkspaceSession(workspaceStorage.renameFolder);
  const moveFolderToFolder = withWorkspaceSession(workspaceStorage.moveFolderToFolder);
  const toggleFavorite = withWorkspaceSession(workspaceStorage.toggleFavorite);
  const deleteImages = withWorkspaceSession(workspaceStorage.deleteImages);
  const syncLocalImages = withWorkspaceSession(workspaceStorage.syncLocalImages);
  const createPendingVideo = withWorkspaceSession(workspaceStorage.createPendingVideo);
  const updateVideoStatus = withWorkspaceSession(workspaceStorage.updateVideoStatus);
  const getImageById = withWorkspaceSession(workspaceStorage.getImageById);
  const refreshVideoSubmission = withWorkspaceSession((id: string) => refreshPendingVideoSubmission(supabase, userId, id));
  const failStaleVideoSubmission = withWorkspaceSession((id: string, message: string, now: number) =>
    failStalePendingVideo(supabase, userId, id, message, now));
  const createPendingImage = withWorkspaceSession(workspaceStorage.createPendingImage);
  const setImageTaskInfo = withWorkspaceSession(workspaceStorage.setImageTaskInfo);
  const updateImageStatus = withWorkspaceSession(workspaceStorage.updateImageStatus);
  const [isAdminPanelOpen, setIsAdminPanelOpen] = useState(false);
  const [adminGalleryUser, setAdminGalleryUser] = useState<AdminUserSummary | null>(null);
  const [adminGalleryMedia, setAdminGalleryMedia] = useState<GeneratedMedia[]>([]);
  const [isAdminGalleryLoading, setIsAdminGalleryLoading] = useState(false);
  const [adminGalleryError, setAdminGalleryError] = useState<string | null>(null);
  const adminGalleryLoadIdRef = useRef(0);
  const galleryBillingLoadIdRef = useRef(0);


  // Track how many requests are currently active
  const [activeRequests, setActiveRequests] = useState<number>(0);
  const [isBrainstormPreparing, setIsBrainstormPreparing] = useState(false);
  const [promptLoadVersion, setPromptLoadVersion] = useState(0);
  const recreateLoadIdRef = useRef(0);
  const recreateLoadingRef = useRef<number | null>(null);
  const [isRecreateLoading, setIsRecreateLoading] = useState(false);
  const brainstormBatchesRef = useRef(new Map<string, ReturnType<typeof createBrainstormBatch>>());
  useEffect(() => {
    if (!isAuthenticated) brainstormBatchesRef.current.forEach(batch => batch.cancel());
  }, [isAuthenticated]);
  useEffect(() => {
    const check = () => brainstormBatchesRef.current.forEach(batch => batch.check());
    document.addEventListener('visibilitychange', check);
    window.addEventListener('pageshow', check);
    return () => {
      document.removeEventListener('visibilitychange', check);
      window.removeEventListener('pageshow', check);
      brainstormBatchesRef.current.forEach(batch => batch.cancel());
    };
  }, []);

  const [generatedMedia, setGeneratedMedia] = useState<GeneratedMedia[]>([]);
  const generatedMediaRef = useRef<GeneratedMedia[]>([]);
  const lastStaleVideoCheckRef = useRef(new Map<string, number>());
  const checkingStaleVideosRef = useRef(new Set<string>());
  useEffect(() => { generatedMediaRef.current = generatedMedia; }, [generatedMedia]);
  const [imageCostHistory, setImageCostHistory] = useState<{ userId: string; samples: ImageCostSample[] } | null>(null);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [isInitialGalleryLoading, setIsInitialGalleryLoading] = useState(false);
  const [isGalleryIndexLoading, setIsGalleryIndexLoading] = useState(false);
  const [galleryHistoryError, setGalleryHistoryError] = useState<string | null>(null);

  // Generation progress tracking
  const [generationProgress, setGenerationProgress] = useState<{ completed: number; total: number } | null>(null);
  const ownImageJobsRef = useRef(new Set<string>());
  const favoriteTogglesRef = useRef(new Set<string>());
  // Cancelling a running video deletes its card and row; a poll that finishes
  // later must not save the video again.
  const deletedMediaIdsRef = useRef(new Set<string>());

  // Navigation State
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [selectedImageId, setSelectedImageId] = useState<string | null>(null);
  const [isHistoryOpen, setIsHistoryOpen] = useState<boolean>(false);

  // --- URL Hash Sync ---
  // Restore state from hash on mount
  useEffect(() => {
    const parseHash = () => {
      const params = new URLSearchParams(window.location.hash.slice(1));
      const folder = params.get('folder') || null;
      const image = params.get('image') || null;
      setCurrentFolderId(folder);
      setSelectedImageId(image);
    };
    parseHash();
    window.addEventListener('popstate', parseHash);
    return () => window.removeEventListener('popstate', parseHash);
  }, []);

  // Push hash when navigation state changes (skip the initial mount)
  const isInitialMount = useRef(true);
  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }
    const params = new URLSearchParams();
    if (currentFolderId) params.set('folder', currentFolderId);
    if (selectedImageId) params.set('image', selectedImageId);
    const hash = params.toString();
    const newHash = hash ? `#${hash}` : window.location.pathname;
    if (window.location.hash.slice(1) !== hash) {
      window.history.pushState(null, '', newHash);
    }
  }, [currentFolderId, selectedImageId]);

  // Toast notifications
  const toast = useToast();

  const [config, setConfig] = useState<GenerationConfig>({
    prompt: '',
    count: 1,
    aspectRatio: '1:1',
    resolution: '1K',
    imageModel: DEFAULT_IMAGE_MODEL,
    referenceImages: [],
    referenceVideos: [],
    referenceAudios: [],
    mode: 'image',
    videoModel: DEFAULT_VIDEO_MODEL,
    videoOperation: 'generate',
    videoAspectRatio: '16:9',
    videoQuality: '720p',
    videoDuration: 5,
    audioEnabled: true,
    videoPromptExpansionMode: 'balanced',
  });


  // Keep reference metadata out of the main gallery query; read a bounded,
  // user-scoped set separately for total-cost estimates after reload.
  useEffect(() => {
    let cancelled = false;
    const userId = userProfile?.id;
    setImageCostHistory(null);
    if (isAuthenticated && userId) {
      getImageCostHistory().then(samples => {
        if (!cancelled) setImageCostHistory({ userId, samples });
      }).catch(() => {});
    }
    return () => { cancelled = true; };
  }, [isAuthenticated, userProfile?.id]);

  // Load history & templates after authentication
  useEffect(() => {
    if (!isAuthenticated) return;
    let cancelled = false;
    const historyLoadStartedAt = Date.now();
    setIsInitialGalleryLoading(true);
    setIsGalleryIndexLoading(true);
    setGalleryHistoryError(null);

    const loadData = async () => {
      try {
        const [history, savedTemplates] = await Promise.all([
          getImages((partialHistory) => {
            if (cancelled) return;
            // First callback contains exactly the newest 48 rows. Render it
            // immediately while storageService continues hydrating older pages.
            setGeneratedMedia(current => mergeLoadedGalleryHistory(current, partialHistory.map(normalizeStoredMedia), historyLoadStartedAt));
            setIsInitialGalleryLoading(false);
          }, (error) => {
            if (!cancelled) setGalleryHistoryError(error.message);
          }).finally(() => { if (!cancelled) setIsGalleryIndexLoading(false); }),
          // Templates load separately: their failure must not block the gallery.
          getTemplates().catch(error => {
            console.error('Failed to load templates', error);
            if (!cancelled) toast.error('Templates Unavailable', 'Saved templates could not be loaded. Reload to try again.');
            return null;
          }),
        ]);
        if (cancelled) return;

        const normalizedTemplates = (savedTemplates || []).map(template => ({
          ...template,
          config: {
            ...template.config,
            imageModel: resolveImageModel((template.config as any)?.imageModel),
            videoOperation: (template.config as any)?.videoOperation || 'generate',
            videoPromptExpansionMode: (template.config as any)?.videoPromptExpansionMode || 'balanced',
          }
        }));

        // Migrate legacy data
        const migratedHistory = history.map(normalizeStoredMedia);

        setGeneratedMedia(current => mergeLoadedGalleryHistory(current, migratedHistory, historyLoadStartedAt));
        if (savedTemplates) setTemplates(normalizedTemplates);
        
        // Resume pending/processing videos and recover rows that were marked
        // failed only because the provider status endpoint returned a transient
        // balance/transport error after already accepting the task.
        const resumableVideos = migratedHistory.filter(
          m => m.mediaType === 'video' && (
            m.status === 'pending'
            || m.status === 'processing'
            || (
              m.status === 'failed'
              && !!m.taskId
              && /insufficient credits|status.*unavailable|status check failed|failed to fetch|network/i.test(m.error || '')
            )
          )
        );
        for (const pending of resumableVideos) {
          if (pending.taskId) {
            // Pass the full media object so the resume path can carry through
            // videoAspectRatio / videoQuality / videoDuration / audioEnabled /
            // generationCost when it later calls saveVideo. Reading those from
            // React state inside resumeVideoPolling is racy.
            resumeVideoPolling(pending.id, pending.taskId, pending);
          } else if (isStuckPendingMedia(pending, Date.now())) {
            // A pending row may belong to another active tab/device. Only the
            // database's atomic stale-lease check can fail it.
            const message = 'Generation interrupted before task was created';
            scheduleStaleVideoCheck(
              () => failStaleVideoSubmission(pending.id, message, Date.now()),
              () => cancelled,
              () => setGeneratedMedia(prev => prev.map(item =>
                item.id === pending.id && item.status === 'pending'
                  ? { ...item, isLoading: false, status: 'failed', error: message } : item
              )),
            );
          }
        }

        // Resume pending image tasks through their provider-specific saved state.
        const resumableImages = migratedHistory.filter(
          m => m.mediaType === 'image' && !ownImageJobsRef.current.has(m.id) && (m.status === 'pending' || m.status === 'processing')
        );
        for (const pending of resumableImages) {
          resumePendingImage(pending);
        }

        // Start background sync for local-only images
        syncLocalImages().then(() => {
          // You could optionally refresh getImages here, but the local blob URLs
          // will continue to work for this session even if it uploaded to the cloud.
        });
      } catch (e) {
        if (cancelled) return;
        console.error("Failed to load data", e);
        toast.error('Data Load Error', 'Could not load your saved images and templates.');
      } finally {
        if (!cancelled) setIsInitialGalleryLoading(false);
      }
    };
    loadData();
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated]);

  // A different tab/device may still be submitting the video and renewing its
  // shared lease. Never fail a video based on this tab's stale React snapshot.
  useEffect(() => {
    if (!isAuthenticated) return;
    const interval = setInterval(() => {
      const now = Date.now();
      const errMsg = 'Generation request did not start (timed out before a task ID was returned). You can remove this entry.';
      for (const item of generatedMediaRef.current) {
        if (item.mediaType !== 'video' || !isStuckPendingMedia(item, now)
          || checkingStaleVideosRef.current.has(item.id)
          || !allowPeriodicStaleCheck(lastStaleVideoCheckRef.current, item.id, now)) continue;
        checkingStaleVideosRef.current.add(item.id);
        failStaleVideoSubmission(item.id, errMsg, now)
          .then(failed => {
            if (!failed) return;
            setGeneratedMedia(prev => prev.map(media =>
              media.id === item.id && media.status === 'pending' && !media.taskId
                ? { ...media, isLoading: false, status: 'failed' as const, error: errMsg }
                : media
            ));
          })
          .catch(() => {})
          .finally(() => { checkingStaleVideosRef.current.delete(item.id); });
      }

      setGeneratedMedia(prev => {
        let changed = false;
        const next = prev.map(item => {
          if (item.mediaType !== 'image' || !isStuckPendingMedia(item, now)) return item;
          changed = true;
          updateImageStatus(item.id, 'failed', { metadata: { error: errMsg } }).catch(() => {});
          return { ...item, isLoading: false, status: 'failed' as const, error: errMsg };
        });
        return changed ? next : prev;
      });
    }, 15_000);
    return () => clearInterval(interval);
  }, [isAuthenticated]);

  const resetGalleryNavigation = useCallback(() => {
    setCurrentFolderId(null);
    setSelectedImageId(null);
    setIsHistoryOpen(false);
  }, []);

  const handleExitAdminGallery = useCallback(() => {
    adminGalleryLoadIdRef.current += 1;
    setAdminGalleryUser(null);
    setAdminGalleryMedia([]);
    setAdminGalleryError(null);
    setIsAdminGalleryLoading(false);
    resetGalleryNavigation();
  }, [resetGalleryNavigation]);

  const handleViewUserGallery = useCallback(async (user: AdminUserSummary) => {
    if (userProfile?.role !== 'admin') return;
    setIsAdminPanelOpen(false);
    resetGalleryNavigation();

    // Clicking the signed-in admin opens their normal gallery, including any
    // local-only items that have not synced yet.
    if (user.user_id === userProfile?.id) {
      handleExitAdminGallery();
      return;
    }

    const loadId = adminGalleryLoadIdRef.current + 1;
    adminGalleryLoadIdRef.current = loadId;
    setAdminGalleryUser(user);
    setAdminGalleryMedia([]);
    setAdminGalleryError(null);
    setIsAdminGalleryLoading(true);

    try {
      const media = await getImagesForUser(user.user_id);
      if (adminGalleryLoadIdRef.current !== loadId) return;
      setAdminGalleryMedia(media.map(normalizeStoredMedia));
    } catch (error: any) {
      if (adminGalleryLoadIdRef.current !== loadId) return;
      console.error(`Failed to load admin gallery for ${user.user_id}:`, error);
      setAdminGalleryError(error?.message || 'The user gallery could not be loaded.');
    } finally {
      if (adminGalleryLoadIdRef.current === loadId) {
        setIsAdminGalleryLoading(false);
      }
    }
  }, [handleExitAdminGallery, resetGalleryNavigation, userProfile?.id, userProfile?.role]);

  const refreshReconciledGalleryBilling = useCallback(async () => {
    const requestId = ++galleryBillingLoadIdRef.current;
    const galleryId = adminGalleryLoadIdRef.current;
    const ownerId = adminGalleryUser?.user_id;
    try {
      const refreshed = ownerId ? await getImagesForUser(ownerId) : await getImages();
      if (!workspaceActive.current || requestId !== galleryBillingLoadIdRef.current || galleryId !== adminGalleryLoadIdRef.current) return;
      const merge = (current: GeneratedMedia[]) => mergeReconciledGalleryCosts(current, refreshed);
      if (ownerId) setAdminGalleryMedia(merge);
      else setGeneratedMedia(merge);
    } catch { /* Keep current cards when a read or session refresh is unavailable. */ }
  }, [userId, adminGalleryUser?.user_id]);

  useEffect(() => {
    if (userProfile?.role !== 'admin' && (isAdminPanelOpen || adminGalleryUser)) {
      setIsAdminPanelOpen(false);
      handleExitAdminGallery();
    }
  }, [userProfile?.role, isAdminPanelOpen, adminGalleryUser, handleExitAdminGallery]);

  // Renew private media URLs while this verified workspace remains mounted.
  useEffect(() => {
    let cancelled = false;
    let refreshing = false;
    const refresh = async () => {
      if (refreshing || document.visibilityState === 'hidden') return;
      refreshing = true;
      const adminLoadId = adminGalleryLoadIdRef.current;
      try {
        await assertWorkspaceSession();
        const media = adminGalleryUser
          ? await getImagesForUser(adminGalleryUser.user_id)
          : await getImages();
        if (cancelled || adminLoadId !== adminGalleryLoadIdRef.current) return;
        const refreshed = new Map(media.map(item => [item.id, normalizeStoredMedia(item)]));
        const renew = (items: GeneratedMedia[]) => items.map(item => {
          const updated = refreshed.get(item.id);
          // Keep in-flight generation progress; renew only existing media links.
          // An empty saved URL (still saving, or read before completion) never blanks a live one.
          if (!updated?.url) return item;
          return { ...item, url: updated.url, thumbnailUrl: updated.thumbnailUrl || item.thumbnailUrl };
        });
        if (adminGalleryUser) setAdminGalleryMedia(renew);
        else setGeneratedMedia(renew);
      } catch { /* The authorization boundary independently closes revoked sessions. */ }
      finally { refreshing = false; }
    };
    const interval = window.setInterval(() => void refresh(), 10 * 60_000);
    window.addEventListener('focus', refresh);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener('focus', refresh);
    };
  }, [userId, adminGalleryUser?.user_id]);

  const handleSignOut = onSignOut;

  /**
   * Resume a fal.ai GPT Image 2 generation that was in flight when the user
   * closed/refreshed the tab. Reads the request_id + endpoint we stored in the
   * row's metadata at submission time, polls fal until the task resolves,
   * downloads the result, persists the durable Supabase URL, and updates the
   * gallery tile in place.
   */
  const resumePendingImage = async (pending: GeneratedMedia) => {
    if (pending.imageQueue?.version === 1 || pending.openaiStartedAt || pending.imageModel === SUNBURST_MODEL) {
      setActiveRequests(prev => prev + 1);
      try {
        const media = await resumeOpenAIImage(pending, progress => {
          setGeneratedMedia(prev => prev.map(item => item.id === pending.id ? { ...item, imageProgress: progress, isLoading: true } : item));
        }, (imageStage,imageQueueWaitReason) => {
          setGeneratedMedia(previous => previous.map(item => item.id === pending.id
            ? { ...item, imageStage, imageQueueWaitReason, isLoading: true, imageProgress: undefined, status: imageStage === 'generating' ? 'processing' : 'pending' } : item));
        });
        setGeneratedMedia(prev => prev.map(item => item.id === pending.id ? media : item));
      } catch (error: any) {
        setGeneratedMedia(prev => prev.map(item => item.id === pending.id ? { ...item, isLoading: false, status: 'failed', error: error.message } : item));
      } finally { setActiveRequests(prev => Math.max(0, prev - 1)); }
      return;
    }
    if (!pending.falRequestId || !pending.falEndpoint) {
      // No fal handle in metadata -> the submit call never returned. Fail it
      // so the user can see what happened and remove it.
      const errMsg = 'Generation interrupted before the task was created';
      await updateImageStatus(pending.id, 'failed', { metadata: { error: errMsg } });
      setGeneratedMedia(prev => prev.map(item =>
        item.id === pending.id ? { ...item, isLoading: false, status: 'failed', error: errMsg } : item
      ));
      return;
    }

    setActiveRequests(prev => prev + 1);
    setGeneratedMedia(prev => prev.map(item =>
      item.id === pending.id ? { ...item, isLoading: true, status: 'processing', imageProgress: 0, error: undefined } : item
    ));

    try {
      const dataUrl = await resumeGptImage2Task(
        pending.falRequestId,
        pending.falEndpoint,
        (progress) => {
          setGeneratedMedia(prev => prev.map(item =>
            item.id === pending.id ? { ...item, imageProgress: progress, isLoading: true } : item
          ));
        },
      );

      // Save the data URL to Supabase storage so the row gets a durable URL
      // (fal.ai result URLs expire after a short window).
      // Gallery index rows omit references. Restore the selected source before
      // accepting a recovered provider canvas; never save an unprotected edit.
      let restored = pending;
      if (!pending.referenceImages?.length) {
        const full = await getImageById(pending.id);
        if (!full) throw new Error('The queued image references could not be restored.');
        restored = { ...pending, referenceImages: full.referenceImages || [] };
      }
      const source = await prepareProtectedImageSource({ imageModel: restored.imageModel || DEFAULT_IMAGE_MODEL, referenceImages: restored.referenceImages || [], aspectRatio: restored.aspectRatio });
      const completedMedia: GeneratedMedia = await finishProtectedImageEdit({
        ...restored,
        url: dataUrl,
        isLoading: false,
        status: 'completed',
        imageProgress: undefined,
      }, source);
      await assertWorkspaceSession();
      const savedResult = await saveImage(completedMedia);
      const remoteMedia = mergeSavedMedia(completedMedia, savedResult);
      setGeneratedMedia(prev => prev.map(item =>
        item.id === pending.id ? remoteMedia : item
      ));
      await updateImageStatus(pending.id, 'completed', {
        url: remoteMedia.url,
        storagePath: remoteMedia.storagePath,
      });
      toast.success('Image Ready', 'A queued image generation completed.');
    } catch (e: any) {
      const message = e?.message || 'Image generation failed';
      await updateImageStatus(pending.id, 'failed', { metadata: { error: message } });
      setGeneratedMedia(prev => prev.map(item =>
        item.id === pending.id
          ? { ...item, isLoading: false, status: 'failed', error: message, imageProgress: undefined }
          : item
      ));
    } finally {
      setActiveRequests(prev => Math.max(0, prev - 1));
    }
  };

  const persistCompletedVideo = async (media: GeneratedMedia) => {
    const MAX_SAVE_ATTEMPTS = 6;
    for (let attempt = 1; attempt <= MAX_SAVE_ATTEMPTS; attempt++) {
      if (deletedMediaIdsRef.current.has(media.id)) throw new DeletedVideoError();
      await assertWorkspaceSession();
      const savedResult = await saveVideo(media);
      if (savedResult && deletedMediaIdsRef.current.has(media.id)) {
        // Deleted while saving: remove the copy this save just wrote.
        await deleteImage({ ...media, storagePath: savedResult.storagePath, thumbnailPath: savedResult.thumbnailPath }).catch(() => {});
        throw new DeletedVideoError();
      }
      if (savedResult) return savedResult;
      if (attempt < MAX_SAVE_ATTEMPTS) {
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }
    throw new RecoverableVideoTaskError(
      'The video provider completed the task, but the result could not yet be copied to permanent storage. The task ID was saved and the app will retry after refresh.'
    );
  };

  const resumeVideoPolling = async (videoId: string, taskId: string, baseMedia?: GeneratedMedia) => {
    setActiveRequests(prev => prev + 1);
    setGeneratedMedia(prev => prev.map(item =>
      item.id === videoId ? {
        ...item,
        referenceVideos: baseMedia?.referenceVideos || item.referenceVideos || [],
        referenceAudios: baseMedia?.referenceAudios || item.referenceAudios || [],
        isLoading: true,
        error: undefined,
        status: 'processing',
        videoProgress: 0,
        videoStage: 'generating',
      } : item
    ));
    // A resumed poll may complete almost immediately even though the provider
    // has already been working for minutes. Retain the original request time.
    const generationStartedAt = baseMedia?.generationStartedAt || baseMedia?.createdAt || Date.now();

    // Backfill referenceImages from the DB if our in-memory copy lacks them
    // (the gallery's main SELECT omits the heavy reference_images column).
    // This is what lets saveVideo persist refs correctly later.
    if (baseMedia && (!baseMedia.referenceImages || baseMedia.referenceImages.length === 0)) {
      try {
        const full = await getImageById(videoId);
        if (full && full.referenceImages && full.referenceImages.length > 0) {
          baseMedia = { ...baseMedia, referenceImages: full.referenceImages };
        }
      } catch (e) {
        console.warn('resumeVideoPolling: failed to backfill referenceImages', e);
      }
    }

    try {
      const videoResult = await pollVideoTask(taskId, (progress) => {
        setGeneratedMedia(prev => prev.map(item =>
          item.id === videoId ? { ...item, videoProgress: progress, isLoading: true } : item
        ));
      }, baseMedia?.videoModel || DEFAULT_VIDEO_MODEL, baseMedia?.falEndpoint, baseMedia?.falQueueEndpoint);

      if (videoResult.urls.length > 0) {
        const videoUrl = videoResult.urls[0];
        const providerExpandedPrompt = videoResult.expandedPrompt;
        const finalCost = videoResult.actualCostUsd != null
          ? { usd: videoResult.actualCostUsd, source: 'provider_actual' as const }
          : baseMedia?.generationCost;
        const generationCompletedAt = Date.now();
        const generationTime = Math.max(1, Math.round((generationCompletedAt - generationStartedAt) / 1000));

        // The provider result is playable immediately. Keep the card live while
        // the expiring provider URL is copied to permanent Supabase storage.
        setGeneratedMedia(prev => prev.map(item =>
          item.id === videoId ? {
            ...item,
            url: videoUrl,
            providerExpandedPrompt,
            generationTime,
            generationStartedAt,
            generationCompletedAt,
            generationCost: finalCost,
            isLoading: true,
            status: 'processing',
            videoProgress: 1,
            videoStage: 'saving',
          } : item
        ));

        // Keep the expiring provider URL out of the database's canonical URL
        // while it is copied to durable storage.
        const savedResult = await persistCompletedVideo({
          ...(baseMedia || {} as GeneratedMedia),
          id: videoId,
          url: videoUrl,
          mediaType: 'video',
          generationTime,
          generationStartedAt,
          generationCompletedAt,
          generationCost: finalCost,
          providerExpandedPrompt,
          videoOutputDuration:videoResult.duration,
          status: 'completed',
        } as GeneratedMedia);
        const finalUrl = savedResult.publicUrl;

        await updateVideoStatus(videoId, 'completed', {
          url: finalUrl,
          metadata: { generationTime, generationStartedAt, generationCompletedAt, generationCost: finalCost, providerExpandedPrompt, videoOutputDuration:videoResult.duration, storagePath: savedResult.storagePath },
        });

        setGeneratedMedia(prev => prev.map(item =>
          item.id === videoId ? {
            ...item,
            url: finalUrl,
            thumbnailUrl: savedResult.thumbnailUrl || item.thumbnailUrl,
            storagePath: savedResult.storagePath,
            thumbnailPath: savedResult.thumbnailPath,
            isLoading: false,
            status: 'completed',
            generationTime,
            generationStartedAt,
            generationCompletedAt,
            generationCost: finalCost,
            providerExpandedPrompt,
            referenceVideos: baseMedia?.referenceVideos || item.referenceVideos || [],
            videoOutputDuration: videoResult.duration || item.videoOutputDuration,
            referenceAudios: baseMedia?.referenceAudios || item.referenceAudios || [],
            videoProgress: undefined,
            videoStage: undefined,
          } : item
        ));

        toast.success('Video Ready', 'A queued video generation completed.');
      }
    } catch (error: any) {
      if (deletedMediaIdsRef.current.has(videoId)) return;
      const message = error?.message || 'Video generation failed';
      if (isRecoverableVideoTaskError(error)) {
        await updateVideoStatus(videoId, 'processing', { metadata: { pollingWarning: message } });
        setGeneratedMedia(prev => prev.map(item =>
          item.id === videoId
            ? { ...item, isLoading: false, status: 'processing', error: message, videoProgress: undefined, videoStage: undefined }
            : item
        ));
        toast.warning('Video Task Saved', message);
        return;
      }
      await updateVideoStatus(videoId, 'failed', { metadata: { error: message } });
      setGeneratedMedia(prev => prev.map(item =>
        item.id === videoId ? { ...item, isLoading: false, status: 'failed', error: message, videoProgress: undefined, videoStage: undefined } : item
      ));
    } finally {
      setActiveRequests(prev => Math.max(0, prev - 1));
    }
  };

  const handleRecoverVideo = (media: GeneratedMedia) => {
    if (!media.taskId) {
      toast.error('Recovery Unavailable', 'This video does not have a saved provider task ID.');
      return;
    }
    resumeVideoPolling(media.id, media.taskId, media);
  };

  const handleRecoverImage = async (media: GeneratedMedia) => {
    try {
      const recovered = await recoverOpenAIImage(media);
      setGeneratedMedia(previous => previous.map(item => item.id === media.id ? recovered : item));
      toast.success('Image recovered', 'The saved image is back in the gallery. No new image was generated.');
    } catch (error) {
      toast.error('Recovery unavailable', error instanceof Error ? error.message : 'Could not check the saved image.');
    }
  };

  /**
   * Run a single image generation for one placeholder. For fal.ai-backed
   * models (GPT Image 2) we persist a pending row to Supabase so the
   * generation can be resumed across page refreshes -- otherwise refreshing
   * mid-flight would silently drop the in-progress placeholders. For Gemini
   * models the call is fast enough that we still keep the existing
   * in-memory-only flow.
   */
  const runImageGeneration = async (
    placeholder: GeneratedMedia,
    batchConfig: GenerationConfig,
    folderId: string | null,
  ): Promise<{ ok: boolean; error?: string }> => {
    ownImageJobsRef.current.add(placeholder.id);
    try {
      await assertWorkspaceSession();
      const editSource = await prepareProtectedImageSource(batchConfig);
      const generated = await generateMedia(
        batchConfig,
        (progress) => {
          setGeneratedMedia(prev => prev.map(item =>
            item.id === placeholder.id ? { ...item, imageProgress: progress } : item
          ));
        },
        undefined,
        { id: placeholder.id, folderId, onStage: (imageStage,imageQueueWaitReason) => {
          setGeneratedMedia(previous => previous.map(item => item.id === placeholder.id
            ? { ...item, imageStage, imageQueueWaitReason, imageProgress: undefined, status: imageStage === 'generating' ? 'processing' : 'pending' } : item));
        } },
      );
      const media = await finishProtectedImageEdit(generated, editSource);
      media.folderId = folderId;
      media.id = placeholder.id; // Keep the same id so the upsert hits the pending row
      media.originalPrompt = batchConfig.originalPrompt;
      media.promptPreparation = batchConfig.promptPreparation;
      media.youtubeSource = batchConfig.youtubeSource;
      media.imageEditSourceId = placeholder.imageEditSourceId;
      if (media.imageQueue || media.openaiStartedAt) {
        // The server already committed the original, settings and billing.
        // Optional browser persistence/auth must not turn that success into
        // an error card or overwrite the worker's authoritative metadata.
        setGeneratedMedia(prev => prev.map(item => item.id === placeholder.id ? media : item));
        return { ok: true };
      }
      await assertWorkspaceSession();
      const savedResult = await saveImage(media);
      const remoteMedia = savedResult ? mergeSavedMedia(media, savedResult) : { ...media, syncStatus: 'local-only' as const };
      setGeneratedMedia(prev => prev.map(item =>
        item.id === placeholder.id ? remoteMedia : item
      ));
      if (savedResult) await updateImageStatus(placeholder.id, 'completed', {
        url: remoteMedia.url,
        storagePath: remoteMedia.storagePath,
        metadata: { imagePromptCategory: batchConfig.imagePromptCategory, ...(batchConfig.originalPrompt != null ? { originalPrompt: batchConfig.originalPrompt } : {}) },
      });
      return { ok: true };
    } catch (error: any) {
      const message = (error as any)?.message || 'Generation failed';
      setGeneratedMedia(prev => prev.map(item =>
        item.id === placeholder.id
          // Clear the submission stage too: Gallery hides Recover while it reads 'preparing'.
          ? { ...item, isLoading: false, url: '', status: 'failed', error: message, imageProgress: undefined, imageStage: undefined, imageQueueWaitReason: undefined }
          : item
      ));
      return { ok: false, error: message };
    }
  };

  const handleGenerate = async (requestConfig: GenerationConfig = config, fromEditor = false) => {
    if (!fromEditor && recreateLoadingRef.current !== null) {
      toast.info('Loading saved references', 'Wait for the saved references to finish loading before generating.');
      return;
    }
    // Each request owns a snapshot. Gallery edits must not mutate the main
    // composer or depend on a setState update arriving before Generate.
    const config = requestConfig.mode === 'image' && getActiveImageModel(requestConfig.imageModel) !== requestConfig.imageModel
      ? { ...requestConfig, imageModel: getActiveImageModel(requestConfig.imageModel) } : requestConfig;
    const ignoresText=config.mode==='video'&&config.videoModel==='minimax-h3'&&H3_MAX_CAPABILITIES[getH3MaxMode(config)].prompt==='unsupported';
    if (!ignoresText && isEnhancedPromptStale(config)) {
      if (fromEditor) throw new Error('Enhance again or revert before generating with this model.');
      toast.warning('Re-enhance Required', 'The model, action, or references changed after Enhance. Revert to the original prompt, then Enhance again.');
      return;
    }

    // Video generation flow -- persists to DB immediately
    if (config.mode === 'video') {
      if (config.videoModel!=='minimax-h3'&&!config.prompt.trim()) return;
      if (config.videoModel === 'seedance-2.5' && !config.referenceVideos?.some(video => video.isContinuation)) {
        const frameError = getSeedanceFrameError(config.referenceImages, config.referenceVideos?.length || 0, config.referenceAudios?.length || 0, config.videoOperation);
        if (frameError) { toast.warning('Frame setup', frameError); return; }
      }
      if (config.videoModel === 'minimax-h3') {
        const error=getH3MaxConfigError(config);
        if(error){toast.warning('H3 Max inputs',error);return;}
      }
      if (config.videoModel !== 'minimax-h3' && config.videoOperation !== 'generate' && (config.referenceVideos?.length || 0) === 0) {
        const actionLabel = config.videoOperation === 'reference_edit'
          ? 'Seedance 2.0 Ref Edit'
          : `Video ${config.videoOperation === 'edit' ? 'Edit' : 'Extend'}`;
        toast.warning('Source Video Required', `Add a source video before using ${actionLabel}.`);
        return;
      }
      const h3MaxMode=config.videoModel==='minimax-h3'?getH3MaxMode(config):undefined;
      const requestedVideoDuration = config.videoModel!=='minimax-h3'&&config.videoOperation === 'edit' ? -1 : config.videoDuration;
      const effectiveVideoPromptExpansionMode = config.videoModel === 'minimax-h3'
        ? config.h3MaxOptions?.promptExpansionMode || config.videoPromptExpansionMode || 'balanced'
        : config.videoPromptExpansionMode;
      const requestedVideoAspectRatio = h3MaxMode
        ? H3_MAX_CAPABILITIES[h3MaxMode].aspectRatios.length?config.videoAspectRatio:'adaptive'
        : config.videoOperation === 'edit' || config.videoOperation === 'extend'?'adaptive':config.videoAspectRatio;

      const videoId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const genStart = Date.now();

      const placeholder: GeneratedMedia = {
        id: videoId,
        url: '',
        prompt: config.prompt,
        originalPrompt: config.originalPrompt,
        promptPreparation: config.promptPreparation,
        aspectRatio: '16:9',
        resolution: '1K',
        createdAt: genStart,
        referenceImages: config.referenceImages,
        referenceVideos: config.referenceVideos,
        referenceAudios: config.referenceAudios,
        folderId: currentFolderId,
        isLoading: true,
        isFavorite: false,
        mediaType: 'video',
        videoModel: config.videoModel || DEFAULT_VIDEO_MODEL,
        videoOperation: config.videoOperation || 'generate',
        videoAspectRatio: requestedVideoAspectRatio,
        videoQuality: config.videoQuality,
        videoDuration: requestedVideoDuration,
        audioEnabled: config.audioEnabled,
        videoPromptExpansionMode: effectiveVideoPromptExpansionMode,
        h3MaxMode, h3MaxOptions: config.h3MaxOptions,
        generationStartedAt: genStart,
        videoProgress: 0,
        videoStage: 'generating',
        status: 'pending',
      };

      setGeneratedMedia(prev => [placeholder, ...prev]);
      setActiveRequests(prev => prev + 1);

      // Save to DB immediately so it survives refresh even before we get a task ID
      const pendingSaved=await createPendingVideo(videoId, '', config.prompt, {
        videoModel: config.videoModel || DEFAULT_VIDEO_MODEL,
        videoOperation: config.videoOperation || 'generate',
        videoAspectRatio: requestedVideoAspectRatio,
        videoQuality: config.videoQuality,
        videoDuration: requestedVideoDuration,
        audioEnabled: config.audioEnabled,
        videoPromptExpansionMode: effectiveVideoPromptExpansionMode,
        h3MaxMode, h3MaxOptions: config.h3MaxOptions,
        folderId: currentFolderId,
        referenceImages: config.referenceImages,
        referenceVideos: config.referenceVideos,
        referenceAudios: config.referenceAudios,
        generationStartedAt: genStart,
        originalPrompt: config.originalPrompt,
        promptPreparation: config.promptPreparation,
      });

      if(!pendingSaved){
        const message='Could not save this video job. No generation request was sent. Try again shortly.';
        setGeneratedMedia(items=>items.map(item=>item.id===videoId?{...item,isLoading:false,status:'failed',error:message}:item));
        setActiveRequests(value=>Math.max(0,value-1));toast.error('Video not submitted',message);return;
      }

      if (deletedMediaIdsRef.current.has(videoId)) {
        // Deleted while its row was being created: remove that row and submit nothing.
        await deleteImage(placeholder).catch(() => {});
        setActiveRequests(value => Math.max(0, value - 1));
        return;
      }

      // Keep the shared pending row alive while uploads, preprocessing and
      // the provider's initial task creation are in flight.
      const submissionHeartbeat = setInterval(() => {
        refreshVideoSubmission(videoId).catch(() => {});
      }, VIDEO_SUBMISSION_HEARTBEAT_INTERVAL_MS);

      const progressToastId = toast.loading(
        'Generating video...',
        config.videoModel === 'minimax-h3'
          ? 'H3 Max usually renders a 5-second clip in a few seconds; queue time can vary.'
          : 'Video generation may take 1-3 minutes.'
      );

      try {
        const { taskId, endpoint, queueEndpoint, cost, mode, referenceImages, referenceVideos, referenceAudios } = await createVideoTask(config,{id:videoId});

        // Update DB row with the real task_id now that we have it
        await updateVideoStatus(videoId, 'processing', {
          referenceImages,
          metadata: {
            generationCost: cost, providerModel: endpoint, generationProvider: taskId.startsWith('bs_openrouter_') ? 'openrouter' : taskId.startsWith('bs_fal_') || config.videoModel === 'minimax-h3' ? 'fal' : 'evolink',
            referenceVideos,
            referenceAudios,
            falEndpoint: endpoint,
            falQueueEndpoint: queueEndpoint,
            videoOperation: config.videoOperation || 'generate',
            videoPromptExpansionMode: effectiveVideoPromptExpansionMode,
        h3MaxMode, h3MaxOptions: config.h3MaxOptions,
          },
        });
        // Also store task_id
        if (supabase) {
          await supabase.from('generations').update({ task_id: taskId }).eq('id', videoId);
        }
        clearInterval(submissionHeartbeat);

        // Log as soon as EvoLink accepts/reserves credits for the task. The
        // previous success-only logging omitted billed tasks that later hit a
        // polling, storage, or provider failure and materially understated
        // the admin dashboard's video spend.
        // H3 acceptance is logged by the server, so a lost browser response
        // cannot omit that charge or insert the same request twice.
        await assertWorkspaceSession();
        if (config.videoModel !== 'minimax-h3') logVideoUsage(config.prompt, 1, config, mode, cost);

        setGeneratedMedia(prev => prev.map(item =>
          item.id === videoId ? { ...item, status: 'processing', taskId, generationProvider: taskId.startsWith('bs_openrouter_') ? 'openrouter' : taskId.startsWith('bs_fal_') || config.videoModel === 'minimax-h3' ? 'fal' : 'evolink', falEndpoint: endpoint, falQueueEndpoint: queueEndpoint, generationCost: cost, referenceImages: referenceImages || item.referenceImages, referenceVideos, referenceAudios } : item
        ));

        const videoResult = await pollVideoTask(taskId, (progress) => {
          setGeneratedMedia(prev => prev.map(item =>
            item.id === videoId ? { ...item, videoProgress: progress } : item
          ));
          toast.updateToast(progressToastId, { progress: Math.round(progress * 100) });
        }, config.videoModel || DEFAULT_VIDEO_MODEL, endpoint, queueEndpoint);

        if (videoResult.urls.length > 0) {
          const videoUrl = videoResult.urls[0];
          const providerExpandedPrompt = videoResult.expandedPrompt;
          const finalCost = videoResult.actualCostUsd != null
            ? { usd: videoResult.actualCostUsd, source: 'provider_actual' as const }
            : cost;
          const generationCompletedAt = Date.now();
          const generationTime = Math.max(1, Math.round((generationCompletedAt - genStart) / 1000));

          // Make the completed fal/EvoLink output playable now. Saving the
          // durable copy continues without holding the card at a misleading
          // "Generating 100%" state.
          setGeneratedMedia(prev => prev.map(item =>
            item.id === videoId ? {
              ...item,
              url: videoUrl,
              providerExpandedPrompt,
              generationTime,
              generationStartedAt: genStart,
              generationCompletedAt,
              generationCost: finalCost,
              referenceImages:referenceImages||item.referenceImages,
              referenceVideos,
              referenceAudios,
              videoOutputDuration:videoResult.duration,
              isLoading: true,
              status: 'processing',
              videoProgress: 1,
              videoStage: 'saving',
            } : item
          ));
          toast.updateToast(progressToastId, {
            title: 'Saving video to Gallery...',
            message: 'The video is ready to play while a permanent copy is saved.',
            progress: 100,
          });

          // Keep the expiring provider URL out of the database's canonical URL
          // while it is copied to durable storage.
          const savedResult = await persistCompletedVideo({
            ...placeholder,
            url: videoUrl,
            generationTime,
            generationStartedAt: genStart,
            generationCompletedAt,
            generationCost: finalCost,
            providerExpandedPrompt,
            videoOutputDuration:videoResult.duration,
            referenceImages:referenceImages||placeholder.referenceImages,
            referenceVideos,
            referenceAudios,
            falEndpoint: endpoint,
            falQueueEndpoint: queueEndpoint,
            status: 'completed',
          });

          const finalUrl = savedResult.publicUrl;

          // Now persist the durable URL to the DB.
          await updateVideoStatus(videoId, 'completed', {
            url: finalUrl,
            metadata: { generationTime, generationStartedAt: genStart, generationCompletedAt, generationCost: finalCost, providerExpandedPrompt, videoOutputDuration:videoResult.duration, storagePath: savedResult.storagePath },
          });

          setGeneratedMedia(prev => prev.map(item =>
            item.id === videoId ? {
              ...item,
              url: finalUrl,
              thumbnailUrl: savedResult.thumbnailUrl || item.thumbnailUrl,
              storagePath: savedResult.storagePath,
              thumbnailPath: savedResult.thumbnailPath,
              isLoading: false,
              status: 'completed',
              generationTime,
              generationStartedAt: genStart,
              generationCompletedAt,
              generationCost: finalCost,
              providerExpandedPrompt,
              referenceVideos,
              referenceAudios,
              videoProgress: undefined,
              videoStage: undefined,
            } : item
          ));

          toast.dismissToast(progressToastId);
          toast.success('Generation Complete', 'Video created successfully.');
        }
      } catch (error: any) {
        if (deletedMediaIdsRef.current.has(videoId)) { toast.dismissToast(progressToastId); return; }
        console.error("Video generation failed", error);
        const { title, message } = parseErrorMessage(error);

        if (isRecoverableVideoTaskError(error)) {
          await updateVideoStatus(videoId, 'processing', { metadata: { pollingWarning: message } });
          setGeneratedMedia(prev => prev.map(item =>
            item.id === videoId ? {
              ...item,
              isLoading: false,
              status: 'processing',
              error: message,
              videoProgress: undefined,
              videoStage: undefined,
            } : item
          ));
          toast.warning('Video Task Saved', message);
          toast.dismissToast(progressToastId);
          return;
        }

        await updateVideoStatus(videoId, 'failed', {
          metadata: { error: message },
        });

        setGeneratedMedia(prev => prev.map(item =>
          item.id === videoId ? {
            ...item,
            isLoading: false,
            status: 'failed',
            error: message,
            videoProgress: undefined,
            videoStage: undefined,
          } : item
        ));

        toast.error(title, message);
        toast.dismissToast(progressToastId);
      } finally {
        clearInterval(submissionHeartbeat);
        setActiveRequests(prev => Math.max(0, prev - 1));
      }
      return;
    }

    // OpenAI generation has its own server key; Gemini is only required for its text tools.

    try {
      validateImageGenerationReferences(config);
    } catch (error) {
      if (fromEditor) throw error;
      toast.error('Generation blocked', error instanceof Error ? error.message : 'Check the attached references.');
      return;
    }

    const count = config.count;
    const batchConfig = structuredClone(config);
    const timestamp = Date.now();

    // Create temporary placeholders
    const placeholders = Array.from({ length: count }).map(() => ({
      id: crypto.randomUUID(),
      url: '', // Empty for loading
      prompt: batchConfig.prompt,
      originalPrompt: batchConfig.originalPrompt,
      promptPreparation: batchConfig.promptPreparation,
      youtubeSource: batchConfig.youtubeSource,
      aspectRatio: batchConfig.aspectRatio,
      resolution: batchConfig.resolution,
      imageModel: batchConfig.imageModel,
      openaiImageOptions: batchConfig.imageModel === SUNBURST_MODEL ? getOpenAIImageOptions(batchConfig.openaiImageOptions) : undefined,
      imageRequestedSize: batchConfig.imageModel === SUNBURST_MODEL ? getOpenAIImageSize(batchConfig) : undefined,
      imagePromptCategory: batchConfig.imagePromptCategory,
      imageEditSourceId: getGalleryEditSourceId(batchConfig.referenceImages),
      createdAt: timestamp,
      referenceImages: batchConfig.referenceImages,
      folderId: currentFolderId, // Generate IN the current folder
      isLoading: true,
      isFavorite: false,
      mediaType: 'image',
    } as GeneratedMedia));

    // Add placeholders to state immediately
    setGeneratedMedia(prev => [...placeholders, ...prev]);
    setActiveRequests(prev => prev + count);

    // Initialize progress tracking
    setGenerationProgress(previous => previous ? { ...previous, total: previous.total + count } : { completed: 0, total: count });

    // Show progress toast
    const progressToastId = toast.loading(
      `Generating ${count} image${count > 1 ? 's' : ''}...`,
      'Please wait while your images are being created.'
    );

    let completedCount = 0;
    let failedCount = 0;

    // Launch requests via the helper, which persists pending rows for fal jobs.
    const promises = placeholders.map(async (placeholder) => {
      const result = await runImageGeneration(placeholder, batchConfig, currentFolderId).catch(error => ({ ok: false, error: error instanceof Error ? error.message : 'Generation failed' }));
      if (result.ok) completedCount++; else {
        failedCount++;
        setGeneratedMedia(previous => previous.map(item => item.id === placeholder.id ? { ...item, isLoading: false, status: 'failed', error: result.error, imageProgress: undefined } : item));
        toast.error('Generation failed', result.error || 'Unknown error');
      }
      setActiveRequests(prev => Math.max(0, prev - 1));
      toast.updateToast(progressToastId, { progress: Math.round((completedCount + failedCount) / count * 100) });
      setGenerationProgress(prev => {
        if (!prev) return null;
        return { ...prev, completed: prev.completed + 1 };
      });
    });

    const finishBatch = Promise.all(promises).then(() => {
      toast.dismissToast(progressToastId);
      setGenerationProgress(previous => previous && previous.completed >= previous.total ? null : previous);
      if (failedCount === 0 && completedCount > 0) {
        toast.success('Generation Complete', `Successfully created ${completedCount} image${completedCount > 1 ? 's' : ''}.`);
      } else if (failedCount > 0 && completedCount > 0) {
        toast.warning('Partial Success', `${completedCount} image${completedCount > 1 ? 's' : ''} created, ${failedCount} failed. Failed items remain in the gallery so you can review and remove them.`);
      }
    });
    // Acceptance unlocks the editor; provider work continues in the same gallery
    // queue and durable recovery flow as regular generations.
    if (fromEditor) { void finishBatch; return placeholders.map(item => item.id); }
    await finishBatch;
  };

  const handleBrainstormGenerate = (request: BrainstormGenerationRequest) => {
    const folderId = currentFolderId;
    let settled = 0;
    const finishPreparing = () => {
      if (brainstormBatchesRef.current.delete(batch.id)) {
        setIsBrainstormPreparing(brainstormBatchesRef.current.size > 0);
      }
    };
    const batch = createBrainstormBatch(request, folderId, {
      prepare: (settings, count, options) => brainstormIdeas(settings.referenceImages, request.category, settings.prompt, undefined, count, settings, options),
      generate: runImageGeneration,
      patch: (ids, patch) => {
        const idSet = new Set(ids);
        setGeneratedMedia(previous => previous.map(media => idSet.has(media.id) ? { ...media, ...patch } : media));
      },
      onPrepared: () => {
        finishPreparing();
        toast.updateToast(toastId, { title: `Generating ${batch.placeholders.length} images…`, message: 'Your ideas are ready. Creating images.' });
      },
      onSettled: (completed, failed) => {
        const nextSettled = completed + failed;
        const delta = nextSettled - settled;
        settled = nextSettled;
        setActiveRequests(previous => Math.max(0, previous - delta));
        toast.updateToast(toastId, { progress: Math.round(nextSettled / batch.placeholders.length * 100) });
      },
    });
    brainstormBatchesRef.current.set(batch.id, batch);
    setIsBrainstormPreparing(true);
    setGeneratedMedia(previous => [...batch.placeholders, ...previous]);
    setActiveRequests(previous => previous + batch.placeholders.length);
    const toastId = toast.loading(`Preparing ${batch.placeholders.length} images…`, 'You can follow your batch in the gallery.');
    void batch.run().then(({ completed, failed }) => {
      toast.dismissToast(toastId);
      if (!failed) toast.success('Brainstorm complete', `${completed} images created.`);
      else if (completed) toast.warning('Batch partial', `${completed} created, ${failed} failed. Review the failed cards in the gallery.`);
      else toast.error('Brainstorm stopped', 'No images completed. Review the message on the gallery cards.');
    }).finally(finishPreparing);
  };

  const handleCancelBrainstorm = (id: string) => brainstormBatchesRef.current.get(id)?.cancel();

  const handleClearHistory = async () => {
    try {
      await clearImages();
      setGeneratedMedia(prev => prev.filter(img => img.isLoading));
      toast.success('History Cleared', 'All saved images have been removed.');
    } catch (e) {
      console.error("Failed to clear history", e);
      toast.error('Clear Failed', 'Could not clear image history.');
    }
  };

  const handleDelete = async (media: GeneratedMedia) => {
    deletedMediaIdsRef.current.add(media.id);
    setGeneratedMedia(prev => prev.filter(m => m.id !== media.id));
    try {
      await deleteImage(media);
    } catch (e) {
      console.error("Delete failed", e);
      toast.error('Delete Failed', 'Could not fully delete the image. It will be retried automatically.');
    }
  };

  const handleDeleteMultiple = async (mediaIds: string[]) => {
    const toDelete = generatedMedia.filter(m => mediaIds.includes(m.id));
    mediaIds.forEach(id => deletedMediaIdsRef.current.add(id));
    setGeneratedMedia(prev => prev.filter(m => !mediaIds.includes(m.id)));
    try {
      await deleteImages(toDelete);
      toast.success('Deleted', `${describeMediaCount(toDelete.map(m => m.id), toDelete)} removed.`);
    } catch (e) {
      console.error("Batch delete failed", e);
      toast.error('Delete Failed', 'Some images could not be fully deleted. They will be retried automatically.');
    }
  };

  const handleToggleFavorite = async (media: GeneratedMedia) => {
    // A second optimistic toggle must not race the first request's rollback.
    if (favoriteTogglesRef.current.has(media.id)) return;
    favoriteTogglesRef.current.add(media.id);
    const newVal = !media.isFavorite;
    setGeneratedMedia(prev => prev.map(m => m.id === media.id ? { ...m, isFavorite: newVal } : m));
    try {
      await toggleFavorite(media.id, newVal);
    } catch (e) {
      console.error("Toggle favorite failed", e);
      // Revert on failure
      setGeneratedMedia(prev => prev.map(m => m.id === media.id ? { ...m, isFavorite: !newVal } : m));
    } finally {
      favoriteTogglesRef.current.delete(media.id);
    }
  };

  const handleMoveImages = async (mediaIds: string[], folderId: string | null) => {
    // Store original states for rollback
    const mediaIdSet = new Set(mediaIds);
    const originalFolders = new Map(generatedMedia.filter(img => mediaIdSet.has(img.id)).map(img => [img.id, img.folderId]));

    // Optimistic Update
    setGeneratedMedia(prev => prev.map(img =>
      mediaIdSet.has(img.id) ? { ...img, folderId } : img
    ));

    try {
      await moveImagesToFolder(mediaIds, folderId);
    } catch (e) {
      console.error("Move failed", e);
      toast.error('Move Failed', 'Could not move the selected items to the folder.');
      // Rollback
      setGeneratedMedia(prev => prev.map(img => {
        return originalFolders.has(img.id) && img.folderId === folderId
          ? { ...img, folderId: originalFolders.get(img.id) }
          : img;
      }));
      throw e;
    }
  };

  const handleMoveFolder = async (folderId: string, targetParentId: string | null) => {
    try {
      await moveFolderToFolder(folderId, targetParentId);
    } catch (e) {
      console.error("Move folder failed", e);
      toast.error('Move Failed', 'Could not move folder.');
      throw e;
    }
  };

  const handleDeleteFolder = async (folderId: string) => {
    // Cards in the folder tree are marked too: a video whose row is still being
    // created is not visible to the delete yet. A failed delete unmarks what it kept.
    const marked = new Set<string>();
    let inMemory: GeneratedMedia[] = [];
    const markDeleted = (ids: string[], folderIds: string[] = []) => {
      inMemory = [...inMemory, ...generatedMedia.filter(media => media.folderId && folderIds.includes(media.folderId) && !ids.includes(media.id))];
      [...ids, ...inMemory.map(media => media.id)].forEach(id => {
        if (!deletedMediaIdsRef.current.has(id)) { marked.add(id); deletedMediaIdsRef.current.add(id); }
      });
    };
    try {
      const result = await deleteFolder(folderId, markDeleted);
      markDeleted(result.mediaIds);
      // Their rows may have been created after the delete read the folder.
      await Promise.all(inMemory.map(media => deleteImage(media).catch(() => {})));
      const deletedMediaIds = new Set([...result.mediaIds, ...inMemory.map(media => media.id)]);
      setGeneratedMedia(prev => prev.filter(media => !deletedMediaIds.has(media.id)));
      toast.success(
        'Folder Deleted',
        `${result.folderIds.length} folder${result.folderIds.length === 1 ? '' : 's'} and ${result.mediaIds.length} item${result.mediaIds.length === 1 ? '' : 's'} permanently deleted.`
      );
      return result;
    } catch (error) {
      const kept = new Set([...(error instanceof workspaceStorage.FolderDeleteError ? error.keptMediaIds : []), ...inMemory.map(media => media.id)]);
      kept.forEach(id => { if (marked.has(id)) deletedMediaIdsRef.current.delete(id); });
      console.error('Folder delete failed', error);
      toast.error('Delete Failed', 'The folder and its contents could not be fully deleted.');
      throw error;
    }
  };

  const handleRenameFolder = async (id: string, newName: string) => {
    try {
      await renameFolder(id, newName);
    } catch (e) {
      console.error("Rename failed", e);
      toast.error('Rename Failed', 'Could not rename folder.');
    }
  };

  const handleHistorySelect = (media: GeneratedMedia) => {
    recreateLoadIdRef.current += 1;
    recreateLoadingRef.current = null;
    setIsRecreateLoading(false);
    setConfig(createRecreateConfig(media, resolveImageModel(media.imageModel ?? config.imageModel)));
    setPromptLoadVersion(version => version + 1);
  };

  const handleRecreate = async (media: GeneratedMedia) => {
    const loadId = ++recreateLoadIdRef.current;
    recreateLoadingRef.current = null;
    setIsRecreateLoading(false);
    const initialDraft = createRecreateConfig(media, resolveImageModel(media.imageModel ?? config.imageModel));
    // The saved prompt is already available on the card. Show it immediately;
    // private reference signing or a slow detail fetch must not gate the editor.
    setConfig(initialDraft);
    setPromptLoadVersion(version => version + 1);
    // The gallery's main SELECT omits the heavy reference_images JSONB column,
    // so grid items always arrive here with referenceImages: []. The detail
    // view lazily backfills it via getImageById, but the hover-overlay
    // Re-create button skips that step. Re-fetch on demand so both buttons
    // load the prompt AND the original reference media consistently.
    let resolved = media;
    const refsMissing = !media.referenceImages || media.referenceImages.length === 0;
    const refsUnresolved = (media.referenceImages || []).some(ref => !ref?.data || !String(ref.data).trim());
    const savedReferenceIds = Array.isArray(media.imageGenerationReferenceIds)
      ? media.imageGenerationReferenceIds.filter(Boolean)
      : [];
    const videoRefsMissing = media.mediaType === 'video' && (!media.referenceVideos || media.referenceVideos.length === 0);
    const audioRefsMissing = media.mediaType === 'video' && (!media.referenceAudios || media.referenceAudios.length === 0);
    const generationPromptMissing = media.mediaType !== 'video' && !media.imageGenerationPrompt?.trim();
    // Sunburst persists the placeholder ID itself. A completed temp-* row is
    // durable too; its prefix cannot tell us whether references are saved.
    if ((refsMissing || refsUnresolved || videoRefsMissing || audioRefsMissing || generationPromptMissing) && !media.isLoading) {
      recreateLoadingRef.current = loadId;
      setIsRecreateLoading(true);
      try {
        const full = await getImageById(media.id);
        if (full) {
          resolved = {
            ...media,
            ...Object.fromEntries(Object.entries(full).filter(([, value]) => value !== undefined)),
            // A partial/legacy detail row must not erase an available prompt.
            prompt: full.prompt?.trim() || !media.prompt?.trim() ? full.prompt ?? media.prompt : media.prompt,
            imageGenerationPrompt: full.imageGenerationPrompt ?? media.imageGenerationPrompt,
            imagePromptCategory: full.imagePromptCategory ?? media.imagePromptCategory,
            originalPrompt: full.originalPrompt ?? media.originalPrompt,
            promptPreparation: full.promptPreparation ?? media.promptPreparation,
            youtubeSource: full.youtubeSource ?? media.youtubeSource,
            referenceImages: full.referenceImages || media.referenceImages || [],
            referenceVideos: full.referenceVideos || media.referenceVideos || [],
            referenceAudios: full.referenceAudios || media.referenceAudios || [],
          };
        }
      } catch (e) {
        console.warn('Recreate: failed to fetch full media row', e);
      } finally {
        if (recreateLoadingRef.current === loadId) {
          recreateLoadingRef.current = null;
          setIsRecreateLoading(false);
        }
      }
    }

    // A later Re-create/History choice owns the editor even if this older
    // private-media lookup finishes last.
    if (loadId !== recreateLoadIdRef.current) return;

    // Gallery cards intentionally omit the heavy reference_images column. Do
    // not silently turn a saved identity/reference prompt into a new prompt
    // with missing inputs when the detail fetch failed or a stored object can
    // no longer be signed. The provider would either reject it or blend the
    // wrong identity, so make the recovery action explicit instead.
    const resolvedImageRefs = resolved.referenceImages || [];
    const unresolvedImageRefs = resolvedImageRefs.some(ref => !ref?.data || !String(ref.data).trim());
    const referencesUnavailable = unresolvedImageRefs
      || ((savedReferenceIds.length > 0 || (resolved.imageGenerationReferenceIds?.length || 0) > 0 || refsUnresolved)
        && resolvedImageRefs.length === 0);

    const recreatedMode = resolved.mediaType === 'video' ? 'video' : 'image';
    const recreatedConfig = createRecreateConfig(resolved, resolveImageModel(resolved.imageModel ?? initialDraft.imageModel));
    setConfig(current => mergeRecreateHydration(current, initialDraft, recreatedConfig));
    if (referencesUnavailable) {
      toast.error('References unavailable', 'The saved prompt and settings are loaded. Saved reference images could not be restored; attach them again before generating.');
      return;
    }
    toast.info(
      'Settings Loaded',
      recreatedMode === 'image'
        ? 'Prompt and references loaded. Edit them and Generate directly; Enhance is optional.'
        : recreatedConfig.originalPrompt != null
        ? 'Prepared prompt loaded. Revert restores the original brief.'
        : `Ready to recreate this ${resolved.mediaType === 'video' ? 'video' : 'image'}.`
    );
  };

  const handleGenerateVariation = async (media: GeneratedMedia) => {
    const imageModel = resolveImageModel(media.imageModel ?? config.imageModel);

    const toastId = toast.loading('Creating variation...', 'Generating a new prompt variation');

    try {
      // Variation is also an image-generation entry point. Gallery index rows
      // omit reference_images, so hydrate the complete row before asking the
      // text model for a variation or sending a paid image request.
      let resolved = media;
      const hasMissingRefs = !media.referenceImages || media.referenceImages.length === 0
        || media.referenceImages.some(ref => !ref?.data || !String(ref.data).trim());
      const savedReferenceIds = Array.isArray(media.imageGenerationReferenceIds)
        ? media.imageGenerationReferenceIds.filter(Boolean)
        : [];
      if (hasMissingRefs && savedReferenceIds.length > 0 && !media.isLoading) {
        const full = await getImageById(media.id);
        if (full) {
          resolved = {
            ...media,
            prompt: full.prompt ?? media.prompt,
            imageGenerationPrompt: full.imageGenerationPrompt ?? media.imageGenerationPrompt,
            imagePromptCategory: full.imagePromptCategory ?? media.imagePromptCategory,
            originalPrompt: full.originalPrompt ?? media.originalPrompt,
            referenceImages: full.referenceImages || [],
            youtubeSource: full.youtubeSource ?? media.youtubeSource,
          };
        }
      }
      const variationReferences = resolved.referenceImages || [];
      if (savedReferenceIds.length > 0 && (variationReferences.length === 0 || variationReferences.some(ref => !ref?.data || !String(ref.data).trim()))) {
        throw new Error('Saved reference images could not be restored. Reopen the source image or attach the references again before creating a variation.');
      }

      // Generate a variation of the prompt
      const textOptions = await resolveTextModelPreferences();
      const variedPrompt = await generatePromptVariation(
        resolved.prompt,
        variationReferences,
        { imageModel, aspectRatio: resolved.aspectRatio, resolution: resolved.resolution, openaiImageOptions: resolved.openaiImageOptions, imagePromptCategory: resolved.imagePromptCategory },
        textOptions,
      );

      toast.updateToast(toastId, {
        title: 'Variation ready!',
        message: 'Generating image...',
      });

      // Use the same config as the original image
      const variationConfig: GenerationConfig = {
        prompt: variedPrompt,
        promptPreparation: createPromptPreparation('variation', textOptions),
        youtubeSource: resolved.youtubeSource,
        count: 1,
        aspectRatio: resolved.aspectRatio,
        resolution: resolved.resolution,
        imageModel,
        openaiImageOptions: resolved.openaiImageOptions,
        imagePromptCategory: resolved.imagePromptCategory,
        referenceImages: variationReferences,
        referenceVideos: [],
        referenceAudios: [],
        mode: 'image',
        videoModel: DEFAULT_VIDEO_MODEL,
        videoOperation: 'generate',
        videoAspectRatio: '16:9',
        videoQuality: '720p',
        videoDuration: 5,
        audioEnabled: true,
        videoPromptExpansionMode: 'balanced',
      };

      const timestamp = Date.now();
      const placeholder: GeneratedMedia = {
        id: crypto.randomUUID(),
        url: '',
        prompt: variedPrompt,
        promptPreparation: variationConfig.promptPreparation,
        aspectRatio: variationConfig.aspectRatio,
        resolution: variationConfig.resolution,
        imageModel: variationConfig.imageModel,
        openaiImageOptions: variationConfig.imageModel === SUNBURST_MODEL ? getOpenAIImageOptions(variationConfig.openaiImageOptions) : undefined,
        imageRequestedSize: variationConfig.imageModel === SUNBURST_MODEL ? getOpenAIImageSize(variationConfig) : undefined,
        imagePromptCategory: variationConfig.imagePromptCategory,
        createdAt: timestamp,
        referenceImages: variationConfig.referenceImages,
        folderId: resolved.folderId || currentFolderId,
        isLoading: true,
        isFavorite: false,
        mediaType: 'image' as const,
      };

      setGeneratedMedia(prev => [placeholder, ...prev]);
      setActiveRequests(prev => prev + 1);

      try {
        const editSource = await prepareProtectedImageSource(variationConfig);
        const generated = await generateMedia(variationConfig, progress => {
          setGeneratedMedia(current => current.map(item => item.id === placeholder.id ? { ...item, imageProgress: progress } : item));
        }, undefined, { id: placeholder.id, folderId: media.folderId || currentFolderId, onStage: imageStage => {
          setGeneratedMedia(previous => previous.map(item => item.id === placeholder.id
            ? { ...item, imageStage, imageProgress: undefined, status: imageStage === 'generating' ? 'processing' : 'pending' } : item));
        } });
        const newMedia = await finishProtectedImageEdit(generated, editSource);
        newMedia.folderId = media.folderId || currentFolderId;
        newMedia.promptPreparation = variationConfig.promptPreparation;

        await assertWorkspaceSession();
        const savedResult = newMedia.openaiStartedAt ? null : await saveImage(newMedia);
        const remoteMedia = newMedia.openaiStartedAt ? newMedia : mergeSavedMedia(newMedia, savedResult);

        setGeneratedMedia(prev => prev.map(item =>
          item.id === placeholder.id ? remoteMedia : item
        ));

        toast.dismissToast(toastId);
        toast.success('Variation Generated!', variedPrompt.length > 60 ? variedPrompt.substring(0, 60) + '...' : variedPrompt);
      } catch (error: any) {
        console.error("Variation generation failed", error);
        const { title, message } = parseErrorMessage(error);
        // Like a batch image: keep the failed card. A server-queued job already
        // has a saved failed row that would otherwise reappear after reload.
        setGeneratedMedia(prev => prev.map(item => item.id === placeholder.id
          ? { ...item, isLoading: false, url: '', status: 'failed', error: (error as any)?.message || message, imageProgress: undefined, imageStage: undefined }
          : item));
        toast.dismissToast(toastId);
        toast.error(title, message);
      } finally {
        setActiveRequests(prev => Math.max(0, prev - 1));
      }
    } catch (error: any) {
      console.error("Failed to generate prompt variation", error);
      const { title, message } = parseErrorMessage(error);
      toast.dismissToast(toastId);
      toast.error(title, message);
    }
  };

  // The limit is checked against the latest config inside the updater. flushSync
  // runs that pure updater now, so exactly one toast reports what happened.
  const handleUseAsReference = async (media: GeneratedMedia) => {
    try {
      if (media.mediaType === 'video') {
        let limit: number | null = null;
        flushSync(() => setConfig(prev => {
          const MAX_VIDEOS = prev.videoModel === 'minimax-h3'
            ? prev.h3MaxMode&&prev.h3MaxMode!=='auto'?H3_MAX_CAPABILITIES[getH3MaxMode(prev)].videos.max:3
            : prev.videoModel === 'seedance-2.5'
            ? (prev.videoOperation === 'edit' || prev.videoOperation === 'extend' ? 1 : 10)
            : 3;
          // A zero limit (e.g. Text to Video Max) is full too.
          if ((prev.referenceVideos?.length || 0) >= MAX_VIDEOS) { limit = MAX_VIDEOS; return prev; }
          return {
            ...prev,
            referenceVideos: [
              ...(prev.referenceVideos || []),
              {
                id: Math.random().toString(36).substr(2, 9),
                url: media.url,
                mimeType: 'video/mp4',
                duration: media.videoOutputDuration || media.videoDuration,
                previousPrompt: media.prompt,
              }
            ],
            mode: 'video',
          };
        }));
        if (limit !== null) toast.warning('Limit Reached', `Maximum of ${limit} reference videos allowed for this operation.`);
        else toast.success('Video Reference Added', 'Video added as reference. Switched to video mode.');
        return;
      }

      const response = await fetch(media.url);
      // An expired link returns an error page; never add that as an image.
      if (!response.ok) throw new Error(`Reference download failed (${response.status})`);
      const blob = await response.blob();
      if (!blob.size || /^(?:text\/|application\/json)/i.test(blob.type)) throw new Error('Reference download did not return an image.');

      const reader = new FileReader();
      reader.onloadend = () => {
        if (typeof reader.result === 'string') {
          const base64Data = reader.result;
          let limit: number | null = null;

          flushSync(() => setConfig(prev => {
            const MAX_IMAGES = getReferenceImageLimit(prev);
            if ((prev.referenceImages?.length || 0) >= MAX_IMAGES) { limit = MAX_IMAGES; return prev; }

            return {
              ...prev,
              referenceImages: [
                ...(prev.referenceImages || []),
                {
                  id: Math.random().toString(36).substr(2, 9),
                  data: base64Data,
                  mimeType: blob.type || 'image/png'
                }
              ]
            };
          }));
          if (limit !== null) toast.warning('Limit Reached', `Maximum of ${limit} reference images allowed for this action.`);
          else toast.success('Reference Added', 'Image added as reference.');
        }
      };
      reader.readAsDataURL(blob);
    } catch (e) {
      console.error("Failed to process reference media", e);
      toast.error('Reference Failed', 'Could not add image as reference.');
    }
  };

  // --- Template Handlers ---
  const handleSaveTemplate = async (name: string) => {
    const newTemplate: Template = {
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
      name,
      config: { ...config }, // Snapshot current config
      createdAt: Date.now()
    };

    try {
      const saved = await saveTemplate(newTemplate);
      setTemplates(prev => [saved, ...prev]);
      toast.success('Template Saved', `"${name}" has been saved.`);
    } catch (e) {
      console.error("Failed to save template", e);
      toast.error('Save Failed', e instanceof Error ? e.message : 'Could not save template.');
    }
  };

  const handleUpdateTemplate = async (template: Template) => {
    const updatedTemplate: Template = {
      ...template,
      config: { ...config } // Update with current config
    };
    try {
      const saved = await saveTemplate(updatedTemplate);
      setTemplates(prev => prev.map(t => t.id === template.id ? saved : t));
      toast.success('Template Updated', `"${template.name}" has been updated.`);
    } catch (e) {
      console.error("Failed to update template", e);
      toast.error('Update Failed', e instanceof Error ? e.message : 'Could not update template.');
    }
  };

  const handleDeleteTemplate = async (id: string) => {
    const template = templates.find(t => t.id === id);
    try {
      await deleteTemplate(id);
      setTemplates(prev => prev.filter(t => t.id !== id));
      toast.success('Template Deleted', template ? `"${template.name}" removed.` : 'Template removed.');
    } catch (e) {
      console.error("Failed to delete template", e);
      toast.error('Delete Failed', 'Could not delete template.');
    }
  };

  const handleSelectTemplate = (template: Template) => {
    try {
      const imageModel = resolveImageModel(template.config.imageModel ?? config.imageModel);
      const merged = mergePersonReferenceInputs(template.config.referenceImages || [], config.referenceImages || [], template.config.prompt, config.prompt, template.config.personGroups, config.personGroups);
      const target = { ...template.config, imageModel, referenceImages: merged.references };
      const limit = getReferenceImageLimit(target);
      if (merged.references.length > limit) throw new Error(`Bu şablonla toplam ${merged.references.length} referans oluyor. Önce referans sayısını ${limit} veya altına indir.`);
      recreateLoadIdRef.current += 1;
      recreateLoadingRef.current = null;
      setIsRecreateLoading(false);
      setConfig({
        ...template.config,
        prompt: merged.prompt,
        originalPrompt: undefined,
        promptPreparation: undefined,
        enhancedForMode: undefined,
        enhancedForImageModel: undefined,
        enhancedForImageContextKey: undefined,
        enhancedForVideoModel: undefined,
        enhancedForVideoOperation: undefined,
        enhancedForVideoReferenceKey: undefined,
        enhancedForH3MaxMode: undefined, enhancedForH3MaxOptionsKey: undefined,
        referenceImages: merged.references,
        personGroups: merged.personGroups,
        imageModel,
        count: config.count
      });
      toast.info('Template Applied', `"${template.name}" settings loaded.`);
    } catch (error) {
      toast.error('Template could not be applied', error instanceof Error ? error.message : 'Check the template references.');
    }
  };


  const displayedMedia = adminGalleryUser ? adminGalleryMedia : generatedMedia;

  return (
    <div className="relative h-screen w-full bg-[#0d1117] text-white font-sans selection:bg-violet-500/30 flex flex-col overflow-hidden">

      <WorkspaceBar profile={userProfile} onOpenAdmin={() => setIsAdminPanelOpen(true)} onSignOut={handleSignOut} />
      {/* Admin Panel */}
      {!isLocalWorkspace() && userProfile?.role === 'admin' && <AdminPanel
        isOpen={isAdminPanelOpen}
        onClose={() => setIsAdminPanelOpen(false)}
        onViewUserGallery={handleViewUserGallery}
        onBillingReconciled={refreshReconciledGalleryBilling}
      />}

      <Gallery
        key={adminGalleryUser?.user_id || 'own-gallery'}
        images={displayedMedia}
        currentFolderId={currentFolderId}
        onFolderSelect={setCurrentFolderId}
        selectedImageId={selectedImageId}
        onImageSelect={setSelectedImageId}
        onClear={handleClearHistory}
        onToggleHistory={() => setIsHistoryOpen(!isHistoryOpen)}
        onUseAsReference={handleUseAsReference}
        onRecreate={handleRecreate}
        onRecoverVideo={handleRecoverVideo}
        onRecoverImage={handleRecoverImage}
        onGenerateVariation={handleGenerateVariation}
        onEditGenerate={async editConfig => {
          if (adminGalleryUser) throw new Error('This gallery is read-only.');
          validateImageGenerationReferences(editConfig);
          return await handleGenerate(editConfig, true) as string[];
        }}
        onCancelBrainstorm={handleCancelBrainstorm}
        onDelete={handleDelete}
        onDeleteMultiple={handleDeleteMultiple}
        onToggleFavorite={handleToggleFavorite}
        onMove={handleMoveImages}
        onMoveFolder={handleMoveFolder}
        onDeleteFolder={handleDeleteFolder}
        isHistoryOpen={isHistoryOpen}
        toasts={toast.toasts}
        onDismissToast={toast.dismissToast}
        onDismissAllToasts={toast.dismissAll}
        userProfile={userProfile}
        onSignOut={handleSignOut}
        onOpenAdmin={() => setIsAdminPanelOpen(true)}
        galleryOwner={adminGalleryUser}
        isReadOnly={!!adminGalleryUser}
        isGalleryLoading={adminGalleryUser ? isAdminGalleryLoading : isInitialGalleryLoading}
        isGalleryIndexLoading={adminGalleryUser ? isAdminGalleryLoading : isGalleryIndexLoading}
        galleryLoadError={adminGalleryUser ? adminGalleryError : galleryHistoryError}
        onExitAdminGallery={handleExitAdminGallery}
      />

      {!adminGalleryUser && (
        <Controls
          config={config}
          isDraftLoading={isRecreateLoading}
          promptLoadVersion={promptLoadVersion}
          imageCostHistory={[...generatedMedia, ...(imageCostHistory?.userId === userProfile?.id ? imageCostHistory?.samples || [] : [])]}
          onChange={setConfig}
          onGenerate={handleGenerate}
          onBrainstormGenerate={handleBrainstormGenerate}
          isBrainstormPreparing={isBrainstormPreparing}
          activeRequests={activeRequests}
          generationProgress={generationProgress}
          templates={templates}
          onSaveTemplate={handleSaveTemplate}
          onUpdateTemplate={handleUpdateTemplate}
          onDeleteTemplate={handleDeleteTemplate}
          onSelectTemplate={handleSelectTemplate}
        />
      )}

      <HistoryPanel
        images={generatedMedia.filter(img => !img.isLoading)}
        isOpen={isHistoryOpen && !adminGalleryUser}
        onClose={() => setIsHistoryOpen(false)}
        onSelect={handleHistorySelect}
      />
    </div>
  );
}
