import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Youtube, Loader2, X, Search, TrendingUp, Clock, Check, Eye, Download, AlertCircle, Sparkles } from 'lucide-react';
import {
  isYouTubeConfigured,
  detectInputType,
  resolveChannel,
  getVideoInfo,
  getTopPerformingVideos,
  getLatestVideos,
  downloadThumbnail,
  formatViewCount,
  formatDuration,
  YouTubeChannel,
  YouTubeVideo,
  YouTubeVideoInfo,
} from '../services/youtubeService';
import { analyzeYouTubeVideo } from '../services/youtubeBriefService';
import { getPersonGroups } from '../lib/references/personReferences';
import type { PersonGroupDefinition, ReferenceImage } from '../types';
import type { YouTubeBrainstormPreparation } from '../lib/youtube/youtubeBrainstorm';
import { createTaskDeadline, waitForTask } from '../lib/shared/asyncTask';
import type { TextTaskStage } from '../services/geminiClient';

interface YouTubeChannelRefProps {
  onAddReferences: (images: ReferenceImage[]) => void;
  onPrepareBrainstorm: (prepared: YouTubeBrainstormPreparation) => void;
  referenceImages?: ReferenceImage[];
  personGroups?: PersonGroupDefinition[];
  draftKey: string;
  remainingSlots: number;
}

type Mode = 'input' | 'top' | 'browse' | 'video';

interface DropdownPosition {
  left: number;
  top?: number;
  bottom?: number;
  width: number;
  maxHeight: number;
}

const POPUP_WIDTH = 400;
const VIEWPORT_PADDING = 16;
const POPUP_GAP = 8;
const BRIEF_STAGE_LABELS: Record<'cover' | TextTaskStage, string> = {
  cover: 'Downloading cover…', preparing: 'Preparing video…', connecting: 'Connecting…',
  generating: 'Analyzing video…', finishing: 'Preparing brief…',
};

export const YouTubeChannelRef: React.FC<YouTubeChannelRefProps> = ({
  onAddReferences,
  onPrepareBrainstorm,
  referenceImages = [],
  personGroups = [],
  draftKey,
  remainingSlots,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [inputUrl, setInputUrl] = useState('');
  const [channel, setChannel] = useState<YouTubeChannel | null>(null);
  const [videos, setVideos] = useState<YouTubeVideo[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<Mode>('input');
  const [isLoading, setIsLoading] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  // Browse search filter
  const [browseSearch, setBrowseSearch] = useState('');

  // Video brief state
  const [videoInfo, setVideoInfo] = useState<YouTubeVideoInfo | null>(null);
  const [preparedVideo, setPreparedVideo] = useState<YouTubeBrainstormPreparation | null>(null);
  const [isGeneratingBrief, setIsGeneratingBrief] = useState(false);
  const [briefStage, setBriefStage] = useState<'cover' | TextTaskStage>('cover');
  const [briefElapsed, setBriefElapsed] = useState(0);
  const [selectedPersonIds, setSelectedPersonIds] = useState<number[]>([]);
  const people = getPersonGroups(referenceImages.filter(ref => !ref.isVideoContext), personGroups).filter(group => group.images.length);
  const requestRef = useRef<AbortController | null>(null);
  // Only the latest Top/Browse request may apply its list; reset() also invalidates it.
  const listRequest = useRef(0);
  const previousDraftKey = useRef(draftKey);

  useEffect(() => () => requestRef.current?.abort(), []);
  useEffect(() => {
    if (previousDraftKey.current === draftKey) return;
    previousDraftKey.current = draftKey;
    requestRef.current?.abort();
    requestRef.current = null;
    setIsGeneratingBrief(false);
    setIsLoading(false);
    setPreparedVideo(null);
    setSelectedPersonIds(people.map(group => group.id));
    if (isOpen) setError('Your prompt or people changed. Prepare Brainstorm again with the current selection.');
  }, [draftKey]);

  const buttonRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [dropdownPos, setDropdownPos] = useState<DropdownPosition>({
    left: VIEWPORT_PADDING,
    bottom: VIEWPORT_PADDING,
    width: POPUP_WIDTH,
    maxHeight: 480,
  });
  const [configured, setConfigured] = useState<boolean>(true);
  const configRequest = useRef(0);

  // A failed check (no session yet, network error) or a key added after launch
  // must not stick: check again on each open while it reads as not configured.
  // Opening must not discard the first check, so only a newer check wins.
  useEffect(() => {
    if (configRequest.current && (!isOpen || configured)) return;
    const request = ++configRequest.current;
    isYouTubeConfigured().then((ok) => {
      if (configRequest.current === request) setConfigured(ok);
    });
  }, [isOpen, configured]);

  useEffect(() => {
    if (!isOpen) return;

    const updateDropdownPosition = () => {
      if (!buttonRef.current) return;

      const rect = buttonRef.current.getBoundingClientRect();
      const visualViewport = window.visualViewport;
      const viewportLeft = visualViewport?.offsetLeft || 0;
      const viewportTop = visualViewport?.offsetTop || 0;
      const viewportWidth = visualViewport?.width || window.innerWidth;
      const viewportHeight = visualViewport?.height || window.innerHeight;
      const viewportBottom = viewportTop + viewportHeight;
      const width = Math.min(POPUP_WIDTH, Math.max(0, viewportWidth - VIEWPORT_PADDING * 2));

      const left = Math.min(
        Math.max(rect.left, viewportLeft + VIEWPORT_PADDING),
        Math.max(viewportLeft + VIEWPORT_PADDING, viewportLeft + viewportWidth - width - VIEWPORT_PADDING),
      );
      const spaceAbove = Math.max(0, rect.top - POPUP_GAP - viewportTop - VIEWPORT_PADDING);
      const spaceBelow = Math.max(0, viewportBottom - rect.bottom - POPUP_GAP - VIEWPORT_PADDING);
      const openAbove = spaceAbove >= spaceBelow;

      setDropdownPos(
        openAbove
          ? {
              left,
              bottom: viewportHeight - rect.top + POPUP_GAP,
              width,
              maxHeight: spaceAbove,
            }
          : {
              left,
              top: rect.bottom + POPUP_GAP,
              width,
              maxHeight: spaceBelow,
            },
      );
    };

    updateDropdownPosition();
    window.addEventListener('resize', updateDropdownPosition);
    window.addEventListener('scroll', updateDropdownPosition, true);
    window.visualViewport?.addEventListener('resize', updateDropdownPosition);
    window.visualViewport?.addEventListener('scroll', updateDropdownPosition);

    return () => {
      window.removeEventListener('resize', updateDropdownPosition);
      window.removeEventListener('scroll', updateDropdownPosition, true);
      window.visualViewport?.removeEventListener('resize', updateDropdownPosition);
      window.visualViewport?.removeEventListener('scroll', updateDropdownPosition);
    };
  }, [isOpen]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const t = e.target as Node;
      if (
        isOpen &&
        buttonRef.current && !buttonRef.current.contains(t) &&
        dropdownRef.current && !dropdownRef.current.contains(t)
      ) {
        close();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  const reset = () => {
    listRequest.current += 1;
    requestRef.current?.abort();
    requestRef.current = null;
    setIsLoading(false);
    setIsGeneratingBrief(false);
    setChannel(null);
    setVideos([]);
    setSelectedIds(new Set());
    setMode('input');
    setError(null);
    setDownloadError(null);
    setVideoInfo(null);
    setPreparedVideo(null);
    setBrowseSearch('');
  };

  const close = () => { setIsOpen(false); reset(); };

  // --- Unified lookup: detects video vs channel ---
  const handleLookup = async () => {
    if (!inputUrl.trim() || requestRef.current) return;
    const request = new AbortController();
    requestRef.current = request;
    setIsLoading(true);
    setError(null);

    const detected = detectInputType(inputUrl);

    if (!detected) {
      setError('Could not recognize this URL. Paste a channel or video link.');
      setIsLoading(false);
      requestRef.current = null;
      return;
    }

    try {
      if (detected.kind === 'video') {
        const info = await getVideoInfo(detected.videoId, { signal: request.signal });
        if (request.signal.aborted) return;
        setVideoInfo(info);
        setMode('video');
      } else {
        const ch = await resolveChannel(detected.raw);
        if (request.signal.aborted) return;
        setChannel(ch);
      }
    } catch (err: any) {
      if (!request.signal.aborted) setError(err.message || 'Lookup failed');
    } finally {
      if (requestRef.current === request) { requestRef.current = null; setIsLoading(false); }
    }
  };

  // --- Video brief flow ---
  const applyPreparedVideo = (prepared: YouTubeBrainstormPreparation) => {
    onPrepareBrainstorm(prepared);
    close();
  };

  const handlePrepareBrainstorm = async () => {
    if (!videoInfo || requestRef.current) return;
    const request = new AbortController();
    requestRef.current = request;
    const expectedDraftKey = draftKey;
    const cast = [...selectedPersonIds];
    setError(null);
    setPreparedVideo(null);
    setIsGeneratingBrief(true);
    setBriefStage('cover');
    setBriefElapsed(0);
    // Own the entire preparation, including cover decoding and dependencies
    // that may never settle. Resume checks also cover suspended mobile timers.
    const task = createTaskDeadline(570_000, request.signal, 'Video preparation timed out. Your prompt and people are unchanged. Try again.');
    const startedAt = Date.now();
    const updateProgress = () => {
      task.check();
      if (requestRef.current === request && !task.signal.aborted) setBriefElapsed(Math.floor((Date.now() - startedAt) / 1000));
    };
    const timer = setInterval(updateProgress, 1000);
    window.addEventListener('pageshow', updateProgress);
    document.addEventListener('visibilitychange', updateProgress);
    try {
      const thumbnailData = await waitForTask(downloadThumbnail(videoInfo.thumbnailUrl, { signal: task.signal }), task.signal);
      task.check();
      task.signal.throwIfAborted();
      const analysis = await waitForTask(analyzeYouTubeVideo(videoInfo, thumbnailData, {
        signal: task.signal,
        onStage: stage => {
          task.check();
          if (requestRef.current === request && !task.signal.aborted) setBriefStage(stage);
        },
      }), task.signal);
      task.check();
      task.signal.throwIfAborted();
      const prepared: YouTubeBrainstormPreparation = { video: videoInfo, analysis, selectedPersonIds: cast, expectedDraftKey };
      if (analysis.source !== 'video') throw new Error('Video content could not be analyzed. Please try again or choose another public video.');
      if (analysis.warning) setPreparedVideo(prepared);
      else applyPreparedVideo(prepared);
    } catch (err: any) {
      if (!request.signal.aborted) setError(err.message || 'Could not prepare Brainstorm. Try again.');
    } finally {
      task.dispose();
      clearInterval(timer);
      window.removeEventListener('pageshow', updateProgress);
      document.removeEventListener('visibilitychange', updateProgress);
      if (requestRef.current === request) { requestRef.current = null; setIsGeneratingBrief(false); }
    }
  };

  const cancelPreparation = () => {
    requestRef.current?.abort();
    requestRef.current = null;
    setIsGeneratingBrief(false);
    setError(null);
  };

  // --- Channel flow ---
  const handleLoadTopVideos = async () => {
    if (!channel) return;
    setMode('top');
    setIsLoading(true);
    setError(null);
    setVideos([]);
    setSelectedIds(new Set());
    const request = ++listRequest.current;

    try {
      const vids = await getTopPerformingVideos(channel.uploadsPlaylistId, 10);
      if (listRequest.current !== request) return;
      setVideos(vids);
      // References may have been added while the list loaded; use the current capacity.
      setSelectedIds(new Set(vids.slice(0, maxSelectableRef.current).map((v) => v.id)));
    } catch (err: any) {
      if (listRequest.current === request) setError(err.message || 'Failed to load videos');
    } finally {
      if (listRequest.current === request) setIsLoading(false);
    }
  };

  const handleLoadLatestVideos = async () => {
    if (!channel) return;
    setMode('browse');
    setIsLoading(true);
    setError(null);
    setVideos([]);
    setSelectedIds(new Set());
    const request = ++listRequest.current;

    try {
      const vids = await getLatestVideos(channel.uploadsPlaylistId, 150);
      if (listRequest.current !== request) return;
      setVideos(vids);
    } catch (err: any) {
      if (listRequest.current === request) setError(err.message || 'Failed to load videos');
    } finally {
      if (listRequest.current === request) setIsLoading(false);
    }
  };

  const toggleVideoSelection = useCallback(
    (id: string) => {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (next.has(id)) {
          next.delete(id);
        } else {
          if (next.size >= 10 || next.size >= remainingSlots) return prev;
          next.add(id);
        }
        return next;
      });
    },
    [remainingSlots]
  );

  const handleConfirm = async () => {
    if (selectedIds.size === 0) return;

    setIsDownloading(true);
    setDownloadProgress(0);
    setDownloadError(null);

    // Preselected Top videos and retries can exceed the slots left in the draft.
    const selected = videos.filter((v) => selectedIds.has(v.id)).slice(0, maxSelectable);
    const results: ReferenceImage[] = [];
    const failed: string[] = [];
    let done = 0;

    for (const video of selected) {
      try {
        const data = await downloadThumbnail(video.thumbnailUrl);
        results.push({
          id: Math.random().toString(36).substr(2, 9),
          data,
          mimeType: 'image/jpeg',
          isThumbnailStyle: true,
        });
      } catch (err) {
        console.warn(`Failed to download thumbnail for ${video.id}`, err);
        failed.push(video.id);
      }
      done++;
      setDownloadProgress(Math.round((done / selected.length) * 100));
    }

    if (results.length > 0) {
      onAddReferences(results);
    }

    setIsDownloading(false);
    if (failed.length > 0) {
      // Keep the dialog open with only the failed videos selected, so they can be retried.
      // Slots may have been used during the download: re-select only what still fits.
      const retry = failed.slice(0, maxSelectableRef.current);
      setSelectedIds(new Set(retry));
      const summary = `${failed.length} of ${selected.length} thumbnail${selected.length !== 1 ? 's' : ''} could not be downloaded.`;
      setDownloadError(retry.length ? `${summary} Try again.` : `${summary} No reference slots are free to retry.`);
      return;
    }
    setIsOpen(false);
    reset();
  };

  const maxSelectable = Math.max(0, Math.min(10, remainingSlots));
  const maxSelectableRef = useRef(maxSelectable);
  maxSelectableRef.current = maxSelectable;
  // Free slots can shrink while the dialog is open (paste, drop, a partial add).
  useEffect(() => {
    setSelectedIds(prev => prev.size > maxSelectable ? new Set([...prev].slice(0, maxSelectable)) : prev);
  }, [maxSelectable]);

  return (
    <>
      <button
        ref={buttonRef}
        onClick={() => {
          if (isOpen) close();
          else { reset(); setSelectedPersonIds(people.map(group => group.id)); setIsOpen(true); }
        }}
        className={`w-12 h-12 rounded-lg border transition-all flex flex-col items-center justify-center gap-0.5 shrink-0 ${
          isOpen
            ? 'border-red-500 bg-red-500/20 text-red-400'
            : 'border-dashed border-gray-700 bg-gray-800/30 hover:bg-gray-800 hover:border-gray-500 text-gray-400 hover:text-white'
        }`}
        title="YouTube Channel or Video"
      >
        <Youtube className="w-4 h-4" />
        <span className="text-[8px] font-bold uppercase">YT</span>
      </button>

      {isOpen &&
        createPortal(
          <div
            ref={dropdownRef}
            role="dialog"
            aria-label={mode === 'video' ? 'YouTube video brief' : 'YouTube reference'}
            className="fixed bg-[#0d1117] border border-gray-700 rounded-2xl shadow-2xl z-[200] overflow-x-hidden overflow-y-auto overscroll-contain custom-scrollbar animate-in fade-in slide-in-from-bottom-2 duration-200"
            style={{
              left: `${dropdownPos.left}px`,
              top: dropdownPos.top === undefined ? undefined : `${dropdownPos.top}px`,
              bottom: dropdownPos.bottom === undefined ? undefined : `${dropdownPos.bottom}px`,
              width: `${dropdownPos.width}px`,
              maxHeight: `${dropdownPos.maxHeight}px`,
            }}
          >
            {/* Header */}
            <div className="sticky top-0 z-10 px-4 py-3 bg-[#0d1117] bg-gradient-to-r from-red-900/30 to-transparent border-b border-gray-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Youtube className="w-4 h-4 text-red-400" />
                <span className="text-sm font-semibold text-white">
                  {mode === 'video' ? 'Video → Brainstorm' : 'YouTube Ref'}
                </span>
              </div>
              <button
                onClick={close}
                aria-label="Close YouTube reference"
                className="p-1 text-gray-500 hover:text-white rounded transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {!configured ? (
              <div className="p-6 text-center">
                <AlertCircle className="w-8 h-8 text-gray-600 mx-auto mb-2" />
                <p className="text-sm text-gray-400">YouTube API key not configured</p>
                <p className="text-xs text-gray-600 mt-1">
                  Set <code className="text-violet-400">YOUTUBE_API_KEY</code> in your server environment
                </p>
              </div>
            ) : (
              <>
                {/* Input — shown when no channel/video resolved yet */}
                {mode === 'input' && !channel && (
                  <div className="p-3 border-b border-gray-800">
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={inputUrl}
                        onChange={(e) => { reset(); setInputUrl(e.target.value); }}
                        onKeyDown={(e) => e.key === 'Enter' && handleLookup()}
                        placeholder="@handle, channel URL, or video URL"
                        className="min-w-0 flex-1 bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-red-500/50 focus:ring-1 focus:ring-red-500/30"
                      />
                      <button
                        onClick={handleLookup}
                        aria-label="Look up YouTube link"
                        disabled={isLoading || !inputUrl.trim()}
                        className="px-3 py-2 bg-red-600 hover:bg-red-500 disabled:bg-gray-800 disabled:text-gray-600 rounded-lg text-white text-sm font-medium transition-colors flex items-center gap-1.5"
                      >
                        {isLoading ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Search className="w-4 h-4" />
                        )}
                      </button>
                    </div>
                    <p className="text-[10px] text-gray-600 mt-1.5 px-1">
                      Add your people from Saved References, then paste a <strong className="text-gray-500">video</strong> to prepare thumbnail ideas. No brief needed. Channel links still let you browse covers.
                    </p>
                    {error && <p className="text-xs text-red-400 mt-2">{error}</p>}
                  </div>
                )}

                {/* ======== VIDEO FLOW ======== */}
                {mode === 'video' && videoInfo && (
                  <div className="flex flex-col">
                    {/* Video card */}
                    <div className="p-3 border-b border-gray-800">
                      <div className="flex gap-3">
                        <div className="relative w-[120px] h-[68px] rounded-lg overflow-hidden bg-gray-800 shrink-0">
                          <img src={videoInfo.thumbnailUrl} className="w-full h-full object-cover" alt="" />
                          <div className="absolute bottom-0.5 right-0.5 bg-black/80 text-white text-[9px] font-mono px-1 py-0.5 rounded">
                            {formatDuration(videoInfo.durationSeconds)}
                          </div>
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium text-white line-clamp-2 leading-tight">{videoInfo.title}</p>
                          <p className="text-[10px] text-gray-500 mt-1">{videoInfo.channelTitle}</p>
                          <div className="flex items-center gap-2 mt-1">
                            <span className="text-[10px] text-gray-500 flex items-center gap-0.5">
                              <Eye className="w-3 h-3" /> {formatViewCount(videoInfo.viewCount)}
                            </span>
                            <span className="text-[10px] text-gray-600">
                              {new Date(videoInfo.publishedAt).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}
                            </span>
                          </div>
                        </div>
                      </div>
                      <button
                        onClick={reset}
                        className="text-[10px] text-gray-600 hover:text-white mt-2 underline"
                      >
                        Use a different URL
                      </button>
                    </div>

                    <div className="p-3 space-y-3">
                      <div>
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">People in each thumbnail</p>
                        {people.length ? <div className="mt-2 flex flex-wrap gap-1.5">
                          {people.map(group => <button key={group.id} type="button"
                            aria-label={`Include ${group.label}`} aria-pressed={selectedPersonIds.includes(group.id)}
                            disabled={isGeneratingBrief}
                            onClick={() => {
                              const ids = selectedPersonIds.includes(group.id) ? selectedPersonIds.filter(id => id !== group.id) : [...selectedPersonIds, group.id];
                              setSelectedPersonIds(ids);
                              setPreparedVideo(previous => previous ? { ...previous, selectedPersonIds: ids } : null);
                            }}
                            className={`flex min-w-0 max-w-full items-center gap-1.5 rounded-lg border px-2 py-1.5 text-xs transition-colors ${selectedPersonIds.includes(group.id) ? 'border-violet-500/50 bg-violet-500/15 text-violet-200' : 'border-gray-700 text-gray-500'}`}>
                            {selectedPersonIds.includes(group.id) && <Check className="h-3 w-3 shrink-0" />}
                            <span className="truncate">{group.label}</span><span className="text-[10px] opacity-60">{group.images.length} photos</span>
                          </button>)}
                        </div> : <p className="mt-1 text-xs leading-relaxed text-gray-400">Add saved people or assign reference photos for consistent faces. You can also prepare ideas without selected people.</p>}
                      </div>
                      {preparedVideo ? <div className="space-y-3">
                        <div role="alert" className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs leading-relaxed text-amber-200">
                          {preparedVideo.analysis.warning}
                        </div>
                        <label className="block text-[10px] font-semibold uppercase tracking-wide text-gray-500" htmlFor="youtube-video-brief">Video brief</label>
                        <textarea id="youtube-video-brief" aria-label="Video brief" rows={6}
                          value={preparedVideo.analysis.brief}
                          onChange={event => setPreparedVideo({ ...preparedVideo, analysis: { ...preparedVideo.analysis, brief: event.target.value } })}
                          className="w-full resize-y rounded-lg border border-gray-700 bg-gray-900 p-3 text-xs leading-relaxed text-gray-200 focus:border-violet-500 focus:outline-none" />
                        <label className="block text-[10px] font-semibold uppercase tracking-wide text-gray-500" htmlFor="youtube-thumbnail-promise">Primary thumbnail promise</label>
                        <textarea id="youtube-thumbnail-promise" aria-label="Primary thumbnail promise" rows={3}
                          value={preparedVideo.analysis.premise || ''}
                          onChange={event => setPreparedVideo({ ...preparedVideo, analysis: { ...preparedVideo.analysis, premise: event.target.value } })}
                          className="w-full resize-y rounded-lg border border-gray-700 bg-gray-900 p-3 text-xs leading-relaxed text-gray-200 focus:border-violet-500 focus:outline-none" />
                        <p className="text-[10px] leading-relaxed text-gray-500">Only this promise goes into the creative brief. Keep the necessary verified prices, ratings and units here.</p>
                        <button onClick={() => { try { applyPreparedVideo(preparedVideo); } catch (err) { setError(err instanceof Error ? err.message : 'Could not use this brief.'); } }}
                          disabled={!preparedVideo.analysis.brief.trim() || !preparedVideo.analysis.premise?.trim()}
                          className="w-full rounded-lg bg-amber-400 px-3 py-2.5 text-sm font-semibold text-black disabled:opacity-40">
                          Use analyzed brief
                        </button>
                        <button onClick={() => handlePrepareBrainstorm()} className="text-xs text-gray-400 hover:text-white">Try video analysis again</button>
                      </div> : <button onClick={() => handlePrepareBrainstorm()}
                        disabled={isGeneratingBrief}
                        className="flex w-full items-center justify-center gap-2 rounded-xl bg-lime-400 px-3 py-3 text-sm font-bold text-black transition-colors hover:bg-lime-300 disabled:bg-gray-800 disabled:text-gray-500">
                        {isGeneratingBrief ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                        {isGeneratingBrief ? BRIEF_STAGE_LABELS[briefStage] : 'Analyze full video'}
                      </button>}
                      {isGeneratingBrief && <div className="space-y-2">
                        <div className="flex items-center justify-between gap-3 text-xs text-gray-400">
                          <span role="status">{BRIEF_STAGE_LABELS[briefStage]}</span>
                          <span role="timer" aria-label="Elapsed preparation time" className="shrink-0 font-mono tabular-nums">{Math.floor(briefElapsed / 60)}:{String(briefElapsed % 60).padStart(2, '0')}</span>
                        </div>
                        <button onClick={cancelPreparation} className="min-h-10 w-full rounded-lg border border-gray-700 px-3 py-2 text-xs font-medium text-gray-300 hover:bg-gray-800 hover:text-white">
                          Cancel preparation
                        </button>
                      </div>}
                      {error && <p role="alert" className="text-xs text-red-400">{error}</p>}
                      <p className="text-[10px] leading-relaxed text-gray-500">
                        {isGeneratingBrief
                          ? briefElapsed >= 30
                            ? 'Full-video analysis can take a few minutes. Cancel stops waiting and keeps your video and people selected.'
                            : 'Preparing a brief from the full video and its original cover. Your current prompt stays unchanged until it is ready.'
                          : 'Brainstorm receives the title, primary promise and selected people. The original cover is used for analysis only. Older series covers can be added separately as optional style references. Video analysis is billed separately.'}
                      </p>
                    </div>
                  </div>
                )}

                {/* ======== CHANNEL FLOW ======== */}

                {/* Channel header — only in channel modes */}
                {channel && mode !== 'video' && (
                  <div className="p-3 border-b border-gray-800">
                    <div className="flex items-center gap-3">
                      <img src={channel.thumbnailUrl} className="w-8 h-8 rounded-full bg-gray-800" alt="" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-white truncate">{channel.title}</p>
                      </div>
                      <button
                        onClick={reset}
                        className="text-xs text-gray-500 hover:text-white px-2 py-1 hover:bg-gray-800 rounded transition-colors"
                      >
                        Change
                      </button>
                    </div>
                  </div>
                )}

                {/* Mode Selection — only after channel is resolved */}
                {channel && mode === 'input' && (
                  <div className="p-3 space-y-2">
                    <button
                      onClick={handleLoadTopVideos}
                      className="w-full flex items-center gap-3 p-3 rounded-xl bg-gray-900 border border-gray-800 hover:border-red-500/40 hover:bg-gray-800 transition-all group"
                    >
                      <div className="w-10 h-10 rounded-lg bg-red-500/10 flex items-center justify-center shrink-0">
                        <TrendingUp className="w-5 h-5 text-red-400" />
                      </div>
                      <div className="text-left">
                        <p className="text-sm font-medium text-white group-hover:text-red-300">Top Performing</p>
                        <p className="text-[10px] text-gray-500">Auto-grab top 10 most-viewed from last year (long-form)</p>
                      </div>
                    </button>

                    <button
                      onClick={handleLoadLatestVideos}
                      className="w-full flex items-center gap-3 p-3 rounded-xl bg-gray-900 border border-gray-800 hover:border-violet-500/40 hover:bg-gray-800 transition-all group"
                    >
                      <div className="w-10 h-10 rounded-lg bg-violet-500/10 flex items-center justify-center shrink-0">
                        <Clock className="w-5 h-5 text-violet-400" />
                      </div>
                      <div className="text-left">
                        <p className="text-sm font-medium text-white group-hover:text-violet-300">Browse &amp; Pick</p>
                        <p className="text-[10px] text-gray-500">Choose videos manually (latest first, up to {maxSelectable})</p>
                      </div>
                    </button>
                  </div>
                )}

                {/* Loading State */}
                {isLoading && mode !== 'input' && mode !== 'video' && (
                  <div className="p-8 text-center">
                    <Loader2 className="w-8 h-8 text-red-400 animate-spin mx-auto mb-3" />
                    <p className="text-sm text-gray-400">
                      {mode === 'top' ? 'Finding top performing videos...' : 'Loading videos...'}
                    </p>
                    <p className="text-xs text-gray-600 mt-1">This may take a few seconds</p>
                  </div>
                )}

                {/* Video Grid */}
                {!isLoading && videos.length > 0 && (() => {
                  const query = browseSearch.toLowerCase().trim();
                  const filteredVideos = query
                    ? videos.filter((v) => v.title.toLowerCase().includes(query))
                    : videos;

                  return (
                  <>
                    <div className="px-3 pt-2 pb-1 flex items-center justify-between">
                      <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">
                        {mode === 'top' ? 'Top Performing' : 'Latest Videos'} ({filteredVideos.length})
                      </span>
                      <span className="text-[10px] text-gray-600">
                        {selectedIds.size}/{maxSelectable} selected
                      </span>
                    </div>

                    {/* Search bar for Browse mode */}
                    {mode === 'browse' && (
                      <div className="px-3 pb-2">
                        <input
                          type="text"
                          value={browseSearch}
                          onChange={(e) => setBrowseSearch(e.target.value)}
                          placeholder="Search by title..."
                          className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-1.5 text-xs text-white placeholder-gray-600 focus:outline-none focus:border-red-500/50 focus:ring-1 focus:ring-red-500/30"
                        />
                      </div>
                    )}

                    <div className="max-h-[320px] overflow-y-auto custom-scrollbar px-2 pb-2">
                      <div className="space-y-1.5">
                        {filteredVideos
                          .map((video) => {
                            const isSelected = selectedIds.has(video.id);
                            const isDisabled =
                              !isSelected &&
                              (selectedIds.size >= 10 || selectedIds.size >= remainingSlots);

                            return (
                              <button
                                key={video.id}
                                onClick={() => toggleVideoSelection(video.id)}
                                disabled={isDisabled}
                                className={`w-full flex items-center gap-2.5 p-1.5 rounded-lg transition-all text-left group ${
                                  isSelected
                                    ? 'bg-red-500/10 border border-red-500/30'
                                    : isDisabled
                                    ? 'opacity-40 cursor-not-allowed border border-transparent'
                                    : 'hover:bg-gray-800 border border-transparent hover:border-gray-700'
                                }`}
                              >
                                <div className="relative w-[100px] h-[56px] rounded-md overflow-hidden bg-gray-800 shrink-0">
                                  <img src={video.thumbnailUrl} className="w-full h-full object-cover" alt="" loading="lazy" />
                                  <div className="absolute bottom-0.5 right-0.5 bg-black/80 text-white text-[9px] font-mono px-1 py-0.5 rounded">
                                    {formatDuration(video.durationSeconds)}
                                  </div>
                                  <div className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full border flex items-center justify-center transition-colors ${
                                    isSelected ? 'bg-red-500 border-red-500' : 'bg-black/50 border-gray-500 opacity-0 group-hover:opacity-100'
                                  }`}>
                                    {isSelected && <Check className="w-2.5 h-2.5 text-white" />}
                                  </div>
                                </div>
                                <div className="flex-1 min-w-0">
                                  <p className="text-xs font-medium text-gray-200 line-clamp-2 leading-tight">{video.title}</p>
                                  <div className="flex items-center gap-2 mt-1">
                                    <span className="text-[10px] text-gray-500 flex items-center gap-0.5">
                                      <Eye className="w-3 h-3" /> {formatViewCount(video.viewCount)}
                                    </span>
                                    <span className="text-[10px] text-gray-600">
                                      {new Date(video.publishedAt).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}
                                    </span>
                                  </div>
                                </div>
                              </button>
                            );
                          })}
                      </div>
                    </div>

                    {/* Confirm Button */}
                    <div className="p-3 border-t border-gray-800">
                      {downloadError && !isDownloading && <p role="alert" className="text-xs text-red-400 mb-2">{downloadError}</p>}
                      {isDownloading ? (
                        <div className="space-y-2">
                          <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
                            <div className="h-full bg-red-500 transition-all duration-300 rounded-full" style={{ width: `${downloadProgress}%` }} />
                          </div>
                          <p className="text-xs text-gray-400 text-center">Downloading thumbnails... {downloadProgress}%</p>
                        </div>
                      ) : (
                        <button
                          onClick={handleConfirm}
                          disabled={selectedIds.size === 0}
                          className={`w-full py-2.5 rounded-lg font-semibold text-sm flex items-center justify-center gap-2 transition-all ${
                            selectedIds.size === 0
                              ? 'bg-gray-800 text-gray-600 cursor-not-allowed'
                              : 'bg-red-600 hover:bg-red-500 text-white'
                          }`}
                        >
                          <Download className="w-4 h-4" />
                          Add {selectedIds.size} Thumbnail{selectedIds.size !== 1 ? 's' : ''} as References
                        </button>
                      )}
                    </div>
                  </>
                  );
                })()}

                {/* Error in video/channel fetch */}
                {error && videos.length === 0 && mode !== 'input' && mode !== 'video' && !isLoading && (
                  <div className="p-4 text-center">
                    <AlertCircle className="w-6 h-6 text-red-400 mx-auto mb-2" />
                    <p className="text-xs text-red-400">{error}</p>
                    <button
                      onClick={() => { setMode('input'); setError(null); }}
                      className="text-xs text-gray-500 hover:text-white mt-2 underline"
                    >
                      Go back
                    </button>
                  </div>
                )}
              </>
            )}
          </div>,
          document.body
        )}
    </>
  );
};
