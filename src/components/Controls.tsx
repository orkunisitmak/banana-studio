import { getMediaMimeType as getMimeType } from '../lib/references/mediaMimeType';
import { getReferenceImageLimit } from '../lib/images/imageReferences';
import { useProviderRoute, ProviderRouteControl } from './ProviderRoutingSettings';
import { seedanceProviderError } from '../lib/video/seedanceProviders';
import { SavedReferenceImages } from './SavedReferenceImages';
import { getClipboardImages } from '../lib/references/clipboardImages';
import { displayReferencePrompt, storeReferencePrompt } from '../lib/references/dynamicReferences';
import { getStableImageTag } from '../lib/references/referenceTokens';
import { personColor } from './PersonAssignment';
import { SavedPeople } from './SavedPeople';
import { addSavedPersonToDraft, findPersonMentions, getPersonDefinitions, getPersonGroups, getPersonId, getPersonTag } from '../lib/references/personReferences';
import { getImageCostPreview, type ImageCostSample } from '../lib/images/imageCostPreview';
import { Dropdown } from './ControlDropdown';
import { ImageCountControl, PROMPT_PANEL_CLASS, PROMPT_INPUT_CLASS, PROMPT_TEXTAREA_CLASS, PROMPT_TOOLBAR_CLASS, PROMPT_SETTINGS_CLASS, PROMPT_ACTIONS_CLASS, PROMPT_REVERT_CLASS, promptResizeClass, promptEnhanceClass, promptGenerateClass } from './PromptComposerUI';
import { OpenAIImageSettings } from './OpenAIImageSettings';
import { H3MaxDuration, H3MaxSettings, getH3MaxImageLabel, getH3MaxInputError, getH3MaxUIState } from './H3MaxSettings';
import { estimateH3MaxCost } from '../lib/video/h3MaxPricing';
import { hydrateH3MaxReferenceDimensions, isH3ReferenceDimensionKnown } from '../lib/video/h3MaxReferenceMetadata';
import { H3_MAX_MODE_OPTIONS, type H3MaxSelection } from '../lib/video/h3Max';
import { normalizeH3MaxDraft, removeH3MaxReferenceImages, setH3MaxImageRole, type H3MaxImageRole } from '../lib/video/h3MaxConfig';
import { ImageReferenceSummary } from './ImageReferenceSummary';
import { ImageEditArea } from './ImageEditArea';
import { getOpenAIImageOptions, getOpenAIImageSize, getSunburstReferences, getImagePromptContextKey, SUNBURST_MODEL, validateOpenAIImageOptions, validateOpenAIImageSize } from '../lib/images/openaiImage';
import React, { useRef, useState, useEffect, useLayoutEffect } from 'react';
import { createPortal, flushSync } from 'react-dom';
import { Sparkles, Pencil, X, Wand2, Plus, Minus, Loader2, ImagePlus, ChevronDown, ChevronUp, Check, Ratio, Scan, LayoutTemplate, Save, Trash2, RefreshCw, Eraser, Lightbulb, User, Users, Zap, Image as ImageIcon, Play, FileImage, FolderOpen, GripVertical, Video, Clock, Volume2, Music, Film, DollarSign, SkipForward, Rewind, FastForward, RotateCcw, AlertTriangle } from 'lucide-react';
import { GenerationConfig, ReferenceImage, ReferenceVideo, ReferenceAudio, Template, BrainstormCategory, SavedReferenceImage, IMAGE_MODEL_OPTIONS, VIDEO_MODEL_OPTIONS, VIDEO_ASPECT_RATIO_OPTIONS, VIDEO_QUALITY_OPTIONS, VIDEO_DURATION_OPTIONS, DEFAULT_VIDEO_MODEL, GenerationMode, VideoModelId, VideoOperation, VideoPromptIntent, VideoAspectRatio, VideoQuality, VideoDuration, estimateVideoCost, getVideoPromptIntent, getPromptEnhancementTarget, isEnhancedPromptStale } from '../types';
import { enhancePrompt, enhanceVideoPrompt } from '../services/geminiService';
import { compressImage, estimateBase64Size, saveReferenceImage, getReferenceGallery, deleteReferenceImage, uploadVideoBlobToPublicUrl } from '../services/storageService';
import { YouTubeChannelRef } from './YouTubeChannelRef';
import { resolveTextModelPreferences } from '../lib/prompts/textModels';
import { getTextModelLabel } from '../types';
import { createPromptPreparation } from '../lib/prompts/promptPreparation';
import type { TextTaskStage } from '../services/geminiClient';
import type { BrainstormGenerationRequest } from '../lib/brainstorm/brainstormGeneration';
import { getOriginalImagePrompt } from '../lib/prompts/promptHistory';
import { updateImageDraftPrompt, validateImageGenerationReferences, getSunburstEditIntent } from '../lib/images/imagePrompting';
import { isValidEditRegion } from '../lib/images/imageEditRegion';
import { MAX_VIDEO_UPLOAD_BYTES, MAX_VIDEO_UPLOAD_MB } from '../lib/references/mediaUploadLimits';
import { assignSeedanceFrames, getSeedanceFrameError } from '../lib/video/seedanceFrames';
import { getYouTubeDraftKey, prepareYouTubeBrainstormDraft, type YouTubeBrainstormPreparation } from '../lib/youtube/youtubeBrainstorm';

interface ControlsProps {
  config: GenerationConfig;
  imageCostHistory?: ImageCostSample[];
  onChange: React.Dispatch<React.SetStateAction<GenerationConfig>>;
  onGenerate: () => void;
  onBrainstormGenerate?: (request: BrainstormGenerationRequest) => void;
  isBrainstormPreparing?: boolean;
  isDraftLoading?: boolean;
  promptLoadVersion?: number;
  activeRequests: number;
  generationProgress?: { completed: number; total: number } | null;
  templates: Template[];
  onSaveTemplate: (name: string) => void;
  onUpdateTemplate: (template: Template) => void;
  onDeleteTemplate: (id: string) => void;
  onSelectTemplate: (template: Template) => void;
}

const isH3MetadataOnlyUpdate = (before: GenerationConfig, after: GenerationConfig): boolean => {
  const { referenceImages: beforeImages, referenceVideos: beforeVideos, ...beforeDraft } = before;
  const { referenceImages: afterImages, referenceVideos: afterVideos, ...afterDraft } = after;
  const oldValues = beforeDraft as unknown as Record<string, unknown>, newValues = afterDraft as unknown as Record<string, unknown>;
  if (Object.keys({ ...oldValues, ...newValues }).some(key => oldValues[key] !== newValues[key])) return false;
  const sameReferences = (oldReferences: (ReferenceImage | ReferenceVideo)[], newReferences: (ReferenceImage | ReferenceVideo)[]) => oldReferences.length === newReferences.length && oldReferences.every((reference, index) => {
    const oldReference = reference as unknown as Record<string, unknown>, newReference = newReferences[index] as unknown as Record<string, unknown>;
    return Object.keys({ ...oldReference, ...newReference }).filter(key => key !== 'width' && key !== 'height').every(key => oldReference[key] === newReference[key]);
  });
  return sameReferences(beforeImages, afterImages) && sameReferences(beforeVideos || [], afterVideos || []);
};

const readFileAsBase64 = (file: File | Blob): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
};

const readMediaDuration = (url: string, kind: 'video' | 'audio'): Promise<number | undefined> => {
  return new Promise(resolve => {
    const media = document.createElement(kind);
    let settled = false;
    let timeout = 0;
    const finish = (duration?: number) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      media.onloadedmetadata = null;
      media.onerror = null;
      media.removeAttribute('src');
      media.load();
      resolve(duration);
    };
    timeout = window.setTimeout(() => finish(), 5000);
    media.preload = 'metadata';
    media.onloadedmetadata = () => finish(
      Number.isFinite(media.duration) && media.duration > 0 ? media.duration : undefined
    );
    media.onerror = () => finish();
    media.src = url;
  });
};

const readVideoDuration = (url: string): Promise<number | undefined> => readMediaDuration(url, 'video');
const readAudioDuration = (url: string): Promise<number | undefined> => readMediaDuration(url, 'audio');

const uploadReferenceVideo = async (file: File, allowNativeWebm = false): Promise<ReferenceVideo> => {
  const mimeType = getMimeType(file, file.name);
  const normalizedMime = mimeType.toLowerCase();
  if (!normalizedMime.includes('mp4') && !normalizedMime.includes('quicktime') && !normalizedMime.includes('mov') && !(allowNativeWebm && normalizedMime === 'video/webm')) {
    throw new Error(`${file.name || 'Video'} must be an MP4, MOV${allowNativeWebm ? ', or WebM' : ''} file.`);
  }
  if (file.size === 0) {
    throw new Error(`${file.name || 'Video'} is empty or could not be read.`);
  }
  if (file.size > MAX_VIDEO_UPLOAD_BYTES) {
    throw new Error(`${file.name || 'Video'} is larger than the ${MAX_VIDEO_UPLOAD_MB} MB limit.`);
  }

  // iOS can invalidate a picker-backed File after an async boundary. Convert
  // it to a plain Blob and start the upload while the change event is active,
  // then keep only the durable HTTPS URL in React state.
  const uploadBlob = file.slice(0, file.size, mimeType);
  const previewUrl = URL.createObjectURL(uploadBlob);
  const uploadPromise = uploadVideoBlobToPublicUrl(
    uploadBlob,
    mimeType,
    'vref_video',
    normalizedMime === 'video/webm' ? 'webm' : normalizedMime.includes('quicktime') || normalizedMime.includes('mov') ? 'mov' : 'mp4',
  );
  const durationPromise = readVideoDuration(previewUrl);

  try {
    const [publicUrl, duration] = await Promise.all([uploadPromise, durationPromise]);
    if (!publicUrl) {
      throw new Error(`${file.name || 'Video'} could not be uploaded. Check your connection and try again.`);
    }
    return {
      id: Math.random().toString(36).substr(2, 9),
      url: publicUrl,
      mimeType,
      duration,
      size: file.size,
    };
  } finally {
    URL.revokeObjectURL(previewUrl);
  }
};

// --- Reference Tile Action Popover ---
interface RefActionItem {
  id: string;
  icon: React.ElementType;
  label: string;
  active?: boolean;
  tone?: 'amber' | 'cyan' | 'lime' | 'red' | 'gray';
  disabled?: boolean;
  onClick: () => void;
}

interface RefActionPopoverProps {
  anchorRect: DOMRect;
  items: RefActionItem[];
  children?: React.ReactNode;
  compactActions?: boolean;
  onClose: () => void;
}

const RefActionPopover: React.FC<RefActionPopoverProps> = ({ anchorRect, items, children, compactActions, onClose }) => {
  const panelRef = useRef<HTMLDivElement>(null);
  // Compute an initial anchored position from the anchor rect so the element is rendered
  // at (approximately) the correct place on the very first paint. Using transform(-50%, ...)
  // avoids needing to know the panel's own width/height on first render. We also pick an
  // initial top/bottom guess based on where the anchor sits on screen, so the transition
  // doesn't visibly slide when the final placement matches our guess.
  const guessBelow = anchorRect.top < 200;
  const initialLeft = anchorRect.left + anchorRect.width / 2;
  const initialTop = guessBelow ? anchorRect.bottom + 8 : anchorRect.top - 8;
  const initialYTranslate = guessBelow ? '0' : '-100%';
  const initialOrigin = guessBelow ? 'center top' : 'center bottom';
  const [style, setStyle] = useState<React.CSSProperties>({
    position: 'fixed',
    top: `${initialTop}px`,
    left: `${initialLeft}px`,
    transform: `translate(-50%, ${initialYTranslate}) scale(0.95)`,
    transformOrigin: initialOrigin,
    opacity: 0,
    zIndex: 9999,
    pointerEvents: 'none',
  });
  const [placement, setPlacement] = useState<'top' | 'bottom'>('top');
  const [caretLeft, setCaretLeft] = useState<number>(0);
  const [ready, setReady] = useState(false);

  useLayoutEffect(() => {
    if (!panelRef.current) return;
    // Layout dimensions ignore the opening scale animation.
    const panelWidth = panelRef.current.offsetWidth;
    const naturalHeight = panelRef.current.offsetHeight;
    const margin = 8;
    const viewportW = window.innerWidth;
    const viewportH = window.innerHeight;

    const anchorCenterX = anchorRect.left + anchorRect.width / 2;
    const spaceAbove = anchorRect.top;
    const spaceBelow = viewportH - anchorRect.bottom;
    const placeBottom = spaceAbove < naturalHeight + margin && spaceBelow > spaceAbove;
    const nextPlacement: 'top' | 'bottom' = placeBottom ? 'bottom' : 'top';
    const maxHeight = Math.max(48, (placeBottom ? spaceBelow : spaceAbove) - margin * 2);
    const panelHeight = Math.min(naturalHeight, maxHeight);

    // Clamp center x so the panel stays within viewport margins
    const halfW = panelWidth / 2;
    const minCenter = margin + halfW;
    const maxCenter = viewportW - halfW - margin;
    const centerX = Math.max(minCenter, Math.min(maxCenter, anchorCenterX));

    const desiredTop = placeBottom ? anchorRect.bottom + margin : anchorRect.top - margin - panelHeight;
    const top = Math.max(margin, Math.min(viewportH - panelHeight - margin, desiredTop));
    const origin = placeBottom ? 'center top' : 'center bottom';

    setStyle({
      position: 'fixed',
      top: `${top}px`,
      left: `${centerX}px`,
      transform: 'translateX(-50%) scale(1)',
      transformOrigin: origin,
      opacity: 1,
      zIndex: 9999,
      pointerEvents: 'auto',
      transition: 'transform 150ms ease-out, opacity 150ms ease-out',
      '--ref-popover-max-height': `${maxHeight}px`,
    } as React.CSSProperties);
    setPlacement(nextPlacement);
    // caret x is relative to the panel's left edge
    const panelLeftEdge = centerX - halfW;
    setCaretLeft(Math.max(10, Math.min(panelWidth - 10, anchorCenterX - panelLeftEdge)));
    setReady(true);
  }, [anchorRect, children, compactActions]);

  useEffect(() => {
    const handleOutside = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const handleViewportChange = (event: Event) => { if (!(event.target instanceof Node) || !panelRef.current?.contains(event.target)) onClose(); };
    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('keydown', handleKey);
    window.addEventListener('resize', handleViewportChange);
    // Capture scroll events from any scrollable ancestor, but NOT touchmove
    // so touch scrolling the page still closes cleanly on mobile
    window.addEventListener('scroll', handleViewportChange, true);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('keydown', handleKey);
      window.removeEventListener('resize', handleViewportChange);
      window.removeEventListener('scroll', handleViewportChange, true);
    };
  }, [onClose]);

  const toneClasses = (tone: RefActionItem['tone'], active: boolean, disabled: boolean): string => {
    if (disabled) return 'bg-gray-900 text-gray-600 cursor-not-allowed border-gray-800';
    if (active) {
      switch (tone) {
        case 'amber': return 'bg-amber-500 text-black border-amber-500';
        case 'cyan': return 'bg-cyan-500 text-black border-cyan-500';
        case 'lime': return 'bg-lime-500 text-black border-lime-500';
        case 'red': return 'bg-red-500 text-white border-red-500';
        default: return 'bg-gray-700 text-white border-gray-600';
      }
    }
    switch (tone) {
      case 'amber': return 'bg-gray-800 text-gray-200 border-gray-700 hover:bg-amber-500 hover:text-black hover:border-amber-500 active:bg-amber-500 active:text-black';
      case 'cyan': return 'bg-gray-800 text-gray-200 border-gray-700 hover:bg-cyan-500 hover:text-black hover:border-cyan-500 active:bg-cyan-500 active:text-black';
      case 'lime': return 'bg-gray-800 text-gray-200 border-gray-700 hover:bg-lime-500 hover:text-black hover:border-lime-500 active:bg-lime-500 active:text-black';
      case 'red': return 'bg-gray-800 text-gray-200 border-gray-700 hover:bg-red-500 hover:text-white hover:border-red-500 active:bg-red-500 active:text-white';
      default: return 'bg-gray-800 text-gray-200 border-gray-700 hover:bg-gray-700 active:bg-gray-700';
    }
  };

  return createPortal(
    <div
      ref={panelRef}
      style={style}
      className={`w-[240px] max-w-[calc(100vw-16px)] rounded-xl border shadow-2xl ${compactActions ? 'border-gray-700 bg-[#0d1117] p-1.5' : 'border-gray-700 bg-[#1c2128] p-2'}`}
      onMouseDown={(e) => e.stopPropagation()}
      role="menu"
      aria-hidden={!ready}
    >
      <div className="overflow-y-auto" style={{ maxHeight: `calc(var(--ref-popover-max-height, 100dvh) - ${compactActions ? 14 : 18}px)` }}>
      {children}
      <div className={compactActions ? 'space-y-0.5' : 'grid grid-cols-2 items-stretch gap-1.5'}>
        {items.map((item, index) => {
          const Icon = item.icon;
          const centerLastItem = items.length % 2 === 1 && index === items.length - 1;
          return (
            <button
              key={item.id}
              onClick={item.disabled ? undefined : item.onClick}
              disabled={item.disabled}
              title={item.label}
              className={compactActions ? `flex min-h-8 w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/50 ${item.disabled ? 'cursor-not-allowed text-gray-600' : item.tone === 'red' ? 'text-gray-400 hover:bg-red-500/10 hover:text-red-300' : item.active ? 'bg-[#1b2330] text-white' : 'text-gray-400 hover:bg-gray-800/50 hover:text-gray-200'}` : `flex min-h-[52px] min-w-0 flex-col items-center justify-center gap-1 rounded-lg border px-1.5 py-2 text-[10px] font-semibold transition-colors ${
                centerLastItem ? 'col-span-2 w-[calc(50%-3px)] justify-self-center' : 'w-full'
              } ${toneClasses(item.tone, !!item.active, !!item.disabled)}`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span className={`${compactActions ? 'min-w-0 truncate' : 'whitespace-nowrap'} leading-none`}>{item.label}</span>
            </button>
          );
        })}
      </div>
      </div>
      <div
        className={`absolute w-2 h-2 border-gray-700 rotate-45 ${compactActions ? 'bg-[#0d1117]' : 'bg-[#1c2128]'}`}
        style={{
          left: `${caretLeft - 4}px`,
          ...(placement === 'top'
            ? { bottom: '-5px', borderRight: '1px solid', borderBottom: '1px solid', borderColor: 'rgb(55 65 81)' }
            : { top: '-5px', borderLeft: '1px solid', borderTop: '1px solid', borderColor: 'rgb(55 65 81)' }),
        }}
      />
    </div>,
    document.body
  );
};

export const Controls: React.FC<ControlsProps> = ({
  config,
  imageCostHistory = [],
  onChange,
  onGenerate,
  onBrainstormGenerate,
  isBrainstormPreparing = false,
  isDraftLoading = false,
  promptLoadVersion = 0,
  activeRequests,
  generationProgress,
  templates,
  onSaveTemplate,
  onUpdateTemplate,
  onDeleteTemplate,
  onSelectTemplate,
}) => {
  const refInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const generationBarRef = useRef<HTMLDivElement>(null);
  const promptResizeRef = useRef<{ pointerId: number; lastY: number } | null>(null);
  const [isEnhancing, setIsEnhancing] = useState(false);
  const [enhanceStage, setEnhanceStage] = useState<TextTaskStage>('preparing');
  const [enhanceModelLabel, setEnhanceModelLabel] = useState('');
  const [enhanceError, setEnhanceError] = useState<string | null>(null);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  useEffect(() => { setAttachmentError(null); }, [config.mode, config.imageModel, config.videoModel, config.videoOperation, config.h3MaxMode]);
  const [sizeAdjustment, setSizeAdjustment] = useState<{ size: string; text: string } | null>(null);
  useEffect(() => {
    setGenerationError(null);
  }, [config.prompt, config.originalPrompt, config.referenceImages, config.imageModel, config.mode, config.videoModel, config.videoOperation, config.h3MaxMode]);
  const latestConfigRef = useRef(config);
  latestConfigRef.current = config;
  const h3DimensionAttemptsRef = useRef(new Map<string, string>());
  const h3DimensionsMountedRef = useRef(true);
  useEffect(() => {
    h3DimensionsMountedRef.current = true;
    return () => { h3DimensionsMountedRef.current = false; };
  }, []);
  const preEnhancePrompt = (config.mode === 'image'
    ? getOriginalImagePrompt(config.prompt, config.originalPrompt)
    : config.originalPrompt) ?? null;
  const [isMinimized, setIsMinimized] = useState(false);
  const lastPromptLoadRef = useRef(0);
  useLayoutEffect(() => {
    if (lastPromptLoadRef.current === promptLoadVersion) return;
    if (isMinimized) { setIsMinimized(false); return; }
    const field = textareaRef.current;
    if (!field) return;
    lastPromptLoadRef.current = promptLoadVersion;
    field.setSelectionRange(0, 0);
    field.scrollTop = 0;
  }, [promptLoadVersion, isMinimized]);
  const [isDragging, setIsDragging] = useState(false);
  const [uploadingReferenceVideos, setUploadingReferenceVideos] = useState(0);
  const insertSourceUploadRef = useRef(false);

  useLayoutEffect(() => {
    const element = generationBarRef.current;
    if (!element) return;

    const updateGallerySafeArea = () => {
      const barHeight = element.getBoundingClientRect().height;
      const bottomInset = Number.parseFloat(window.getComputedStyle(element).bottom) || 0;
      document.documentElement.style.setProperty(
        '--generation-bar-safe-area',
        `${Math.ceil(barHeight + bottomInset + 12)}px`,
      );
    };

    updateGallerySafeArea();
    const resizeObserver = new ResizeObserver(updateGallerySafeArea);
    resizeObserver.observe(element);
    window.addEventListener('resize', updateGallerySafeArea);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener('resize', updateGallerySafeArea);
      document.documentElement.style.removeProperty('--generation-bar-safe-area');
    };
  }, [isMinimized]);

  // Mention Dropdown State
  const [mentionState, setMentionState] = useState<{
    active: boolean;
    query: string;
    startIndex: number;
    position: { top: number; left: number } | null;
  }>({ active: false, query: '', startIndex: -1, position: null });
  const [mentionIndex, setMentionIndex] = useState(0);
  
  // Resizable Prompt State
  const MIN_PROMPT_HEIGHT = 96;
  const MAX_PROMPT_HEIGHT = 600;
  const [promptHeight, setPromptHeight] = useState(MIN_PROMPT_HEIGHT);
  const [isResizingPrompt, setIsResizingPrompt] = useState(false);

  // Template Manager State
  const [isTemplateMenuOpen, setIsTemplateMenuOpen] = useState(false);
  const [newTemplateName, setNewTemplateName] = useState('');
  const [isNamingTemplate, setIsNamingTemplate] = useState(false);
  const templateButtonRef = useRef<HTMLButtonElement>(null);
  const templateMenuRef = useRef<HTMLDivElement>(null);
  const [templateMenuPos, setTemplateMenuPos] = useState({ bottom: 0, left: 0 });

  // Brainstorm config only; accepted batches belong to the gallery workflow.
  const [brainstormCategory, setBrainstormCategory] = useState<BrainstormCategory>('youtube_thumbnail');
  const [brainstormError, setBrainstormError] = useState<string | null>(null);
  const brainstormSubmitRef = useRef(false);
  const [isBrainstormPanelOpen, setIsBrainstormPanelOpen] = useState(false);
  const [brainstormIdeaCount, setBrainstormIdeaCount] = useState(5);
  const brainstormButtonRef = useRef<HTMLButtonElement>(null);
  const brainstormPanelRef = useRef<HTMLDivElement>(null);
  const [brainstormPanelPos, setBrainstormPanelPos] = useState({ bottom: 0, left: 0 });
  const MIN_BRAINSTORM_IDEAS = 1;
  const MAX_BRAINSTORM_IDEAS = 20;

  // Reference Gallery State
  const [refGallery, setRefGallery] = useState<SavedReferenceImage[]>([]);
  const [refGalleryError, setRefGalleryError] = useState<string | null>(null);
  const [isRefGalleryOpen, setIsRefGalleryOpen] = useState(false);
  const [refGalleryTab, setRefGalleryTab] = useState<'images' | 'people'>('images');
  const [draggedRefId, setDraggedRefId] = useState<string | null>(null);
  const [isDraggingToGallery, setIsDraggingToGallery] = useState(false);
  const [isDraggingSavedRef, setIsDraggingSavedRef] = useState(false); // New state for visual feedback
  const [draggedGalleryItem, setDraggedGalleryItem] = useState<SavedReferenceImage | null>(null); // Track gallery item being dragged
  const refGalleryRef = useRef<HTMLDivElement>(null);
  const galleryDropdownRef = useRef<HTMLDivElement>(null); // New ref for the portal content
  const [refGalleryPos, setRefGalleryPos] = useState({ bottom: 0, left: 0 });

  // Undo state for reference removal and clearing the composer.
  const [undoStack, setUndoStack] = useState<{ images: ReferenceImage[]; positions?: number[]; prompt?: string; imagePromptCategory?: GenerationConfig['imagePromptCategory']; promptPreparation?: GenerationConfig['promptPreparation']; youtubeSource?: GenerationConfig['youtubeSource']; personGroups?: GenerationConfig['personGroups']; h3MaxOptions?: GenerationConfig['h3MaxOptions']; clearedConfig?: GenerationConfig }[]>([]);

  // Reference tile action popover state
  type RefPopoverKind = 'image' | 'video' | 'audio';
  const [activeRefPopover, setActiveRefPopover] = useState<{ kind: RefPopoverKind; id: string; rect: DOMRect } | null>(null);
  const [editAreaSourceId, setEditAreaSourceId] = useState<string | null>(null);
  const openRefPopover = (kind: RefPopoverKind, id: string, e: React.MouseEvent<HTMLElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setActiveRefPopover(prev => (prev && prev.kind === kind && prev.id === id ? null : { kind, id, rect }));
  };
  const closeRefPopover = () => setActiveRefPopover(null);

  // Refresh shared access when the library opens; never keep revoked cards indefinitely.
  useEffect(() => {
    let cancelled = false;
    const loadRefGallery = async () => {
      try {
        const images = await getReferenceGallery();
        if (!cancelled) { setRefGallery(images); setRefGalleryError(null); }
      } catch (error) {
        // Keep the last loaded list: a failed refresh is not an empty library.
        if (!cancelled) setRefGalleryError(error instanceof Error ? error.message : 'Saved references could not be loaded.');
      }
    };
    void loadRefGallery();
    return () => { cancelled = true; };
  }, [isRefGalleryOpen]);

  // Update gallery dropdown position when opened
  useEffect(() => {
    if (isRefGalleryOpen && refGalleryRef.current) {
      const rect = refGalleryRef.current.getBoundingClientRect();
      setRefGalleryPos({
        bottom: Math.min(window.innerHeight - 80, window.innerHeight - rect.top + 8),
        left: Math.max(8, Math.min(rect.left, window.innerWidth - 344))
      });
    }
  }, [isRefGalleryOpen]);

  // --- Config Handlers ---
  const updateConfig = (key: keyof GenerationConfig, value: any) => {
    onChange(key === 'prompt' ? { ...updateImageDraftPrompt(config, value), promptPreparation: undefined } : { ...config, [key]: value });
  };

  const isH3VideoConfig = config.mode === 'video' && config.videoModel === 'minimax-h3';
  const h3State = getH3MaxUIState(config);
  const h3UsesImageFrames = isH3VideoConfig && h3State.mode === 'image_to_video';
  const h3PromptSupported = !isH3VideoConfig || (h3State.available && h3State.capabilities.prompt !== 'unsupported');
  const promptDisabledMessage = h3PromptSupported ? undefined : 'This action uses the attached media. Text prompts are not used.';
  useEffect(() => {
    if (!h3PromptSupported) setMentionState(current => current.active ? { ...current, active: false } : current);
  }, [h3PromptSupported]);
  useEffect(() => {
    const attempts = h3DimensionAttemptsRef.current;
    if (!isH3VideoConfig) { attempts.clear(); return; }
    const images = config.referenceImages || [], videos = config.referenceVideos || [];
    const currentKeys = new Set([...images.map(image => `image:${image.id}`), ...videos.map(video => `video:${video.id}`)]);
    for (const key of attempts.keys()) if (!currentKeys.has(key)) attempts.delete(key);
    const needsDimensions = (reference: { width?: number; height?: number }) => !isH3ReferenceDimensionKnown(reference.width) || !isH3ReferenceDimensionKnown(reference.height);
    const imageRequests = images.filter(image => needsDimensions(image) && attempts.get(`image:${image.id}`) !== image.data).map(image => ({ ...image }));
    const videoRequests = videos.filter(video => needsDimensions(video) && attempts.get(`video:${video.id}`) !== video.url).map(video => ({ ...video }));
    if (!imageRequests.length && !videoRequests.length) return;
    for (const image of imageRequests) attempts.set(`image:${image.id}`, image.data);
    for (const video of videoRequests) attempts.set(`video:${video.id}`, video.url);
    void hydrateH3MaxReferenceDimensions({ ...config, referenceImages: imageRequests, referenceVideos: videoRequests }).then(loaded => {
      if (!h3DimensionsMountedRef.current) return;
      const loadedImages = new Map(loaded.referenceImages.map(image => [image.id, image]));
      const loadedVideos = new Map(loaded.referenceVideos.map(video => [video.id, video]));
      onChange(current => {
        if (current.mode !== 'video' || current.videoModel !== 'minimax-h3') return current;
        let changed = false;
        const merge = <T extends { width?: number; height?: number }>(reference: T, dimensions: { width?: number; height?: number }): T => {
          const patch: { width?: number; height?: number } = {};
          if (!isH3ReferenceDimensionKnown(reference.width) && isH3ReferenceDimensionKnown(dimensions.width)) patch.width = dimensions.width;
          if (!isH3ReferenceDimensionKnown(reference.height) && isH3ReferenceDimensionKnown(dimensions.height)) patch.height = dimensions.height;
          if (patch.width === undefined && patch.height === undefined) return reference;
          changed = true;
          return { ...reference, ...patch };
        };
        const referenceImages = current.referenceImages.map(image => {
          const dimensions = loadedImages.get(image.id);
          return dimensions && dimensions.data === image.data ? merge(image, dimensions) : image;
        });
        const referenceVideos = (current.referenceVideos || []).map(video => {
          const dimensions = loadedVideos.get(video.id);
          return dimensions && dimensions.url === video.url ? merge(video, dimensions) : video;
        });
        return changed ? { ...current, referenceImages, referenceVideos } : current;
      });
    }).catch(() => { /* Keep the conservative unknown-shape estimate. */ });
  }, [isH3VideoConfig, config.referenceImages, config.referenceVideos, onChange]);
  // Older saved image templates can predate video/audio reference arrays.
  const currentReferenceVideos = config.referenceVideos || [];
  const currentReferenceAudios = config.referenceAudios || [];
  // Seedance 2.5 accepts up to 30 images, 10 videos and 10 audio clips. Edit
  // and Extend have one source video; keeping that constraint in the picker
  // prevents a request that the provider cannot interpret unambiguously.
  const maxReferenceVideos = isH3VideoConfig ? (h3State.available ? h3State.capabilities.videos.max : 0) : config.videoModel === 'seedance-2.5'
    ? (config.videoOperation === 'edit' || config.videoOperation === 'extend' ? 1 : 10)
    : 3;
  const maxReferenceAudios = isH3VideoConfig ? (h3State.available ? h3State.capabilities.audios.max : 0) : config.videoModel === 'seedance-2.5' ? 10 : 3;
  const maxReferenceImages = getReferenceImageLimit(config);
  // Attachments finish after awaits; they use the limits of the latest committed draft.
  const attachLimitsRef = useRef({ images: maxReferenceImages, audios: maxReferenceAudios, videos: maxReferenceVideos, config });
  useLayoutEffect(() => { attachLimitsRef.current = { images: maxReferenceImages, audios: maxReferenceAudios, videos: maxReferenceVideos, config }; });
  const hasStaleEnhancedPrompt = h3PromptSupported && isEnhancedPromptStale(config);

  const formatVideoModel = (model?: VideoModelId) => model === 'seedance-2.0'
    ? 'Seedance 2.0'
    : model === 'seedance-2.5'
      ? 'Seedance 2.5 Relaxed'
      : model === 'minimax-h3'
        ? 'MiniMax H3 Max'
        : 'Video';
  const formatVideoOperation = (operation?: VideoPromptIntent) => operation === 'reference_edit'
    ? 'Ref Edit'
    : operation === 'edit'
      ? 'Edit'
      : operation === 'continue'
        ? 'Continue'
      : operation === 'extend'
        ? 'Extend'
        : 'Generate';
  const enhancedPromptTargetLabel = config.enhancedForMode === 'video'
    ? config.enhancedForVideoModel === 'minimax-h3' && config.enhancedForH3MaxMode ? H3_MAX_MODE_OPTIONS.find(option => option.value === config.enhancedForH3MaxMode)?.label || 'MiniMax H3 Max' : `${formatVideoModel(config.enhancedForVideoModel)} · ${formatVideoOperation(config.enhancedForVideoOperation)}`
    : IMAGE_MODEL_OPTIONS.find(model => model.value === config.enhancedForImageModel)?.label || 'Image';
  const currentPromptTargetLabel = config.mode === 'video'
    ? isH3VideoConfig ? H3_MAX_MODE_OPTIONS.find(option => option.value === h3State.mode)?.label || 'MiniMax H3 Max' : `${formatVideoModel(config.videoModel)} · ${formatVideoOperation(getVideoPromptIntent(config))}`
    : IMAGE_MODEL_OPTIONS.find(model => model.value === config.imageModel)?.label || 'Image';
  const hasEnhanceInput = h3PromptSupported && (config.prompt.trim().length > 0
    || config.referenceImages.length > 0
    || (config.mode === 'video' && ((config.referenceVideos?.length || 0) > 0 || (config.referenceAudios?.length || 0) > 0)));

  const updateVideoModel = (videoModel: VideoModelId) => {
    const isH3 = videoModel === 'minimax-h3';
    const isH3MaxQuality = config.videoQuality === '480p' || config.videoQuality === '768p';
    const isSeedanceQuality = config.videoQuality === '480p' || config.videoQuality === '720p' || config.videoQuality === '1080p';
    const targetH3Duration = h3State.capabilities.duration;
    const normalizedDuration = config.videoDuration === -1 || !Number.isFinite(config.videoDuration)
      ? targetH3Duration?.default || 5
      : isH3
        ? Math.max(targetH3Duration?.min || .92, Math.min(targetH3Duration?.max || 15, config.videoDuration))
        : Math.max(4, Math.min(videoModel === 'seedance-2.5' ? 30 : 15, Math.round(config.videoDuration)));
    const nextOperation: VideoOperation = videoModel === 'seedance-2.5'
      ? config.videoOperation === 'reference_edit'
        ? 'edit'
        : (config.videoOperation || 'generate')
      : videoModel === 'seedance-2.0'
        ? config.videoOperation === 'edit' || config.videoOperation === 'reference_edit'
          ? 'reference_edit'
          : 'generate'
        : 'generate';
    const nextConfig: GenerationConfig = {
      ...config,
      videoModel,
      videoOperation: nextOperation,
      videoDuration: videoModel === 'seedance-2.5' && (nextOperation === 'edit' || config.videoDuration === -1) ? -1 : normalizedDuration,
      videoQuality: isH3
        ? isH3MaxQuality ? config.videoQuality : '768p'
        : isSeedanceQuality ? config.videoQuality : '720p',
      videoAspectRatio: isH3
        ? config.referenceImages.length > 0 ? 'adaptive' : config.videoAspectRatio === 'adaptive' ? '16:9' : config.videoAspectRatio
        : config.videoAspectRatio,
      audioEnabled: isH3 ? true : config.audioEnabled,
      videoPromptExpansionMode: isH3 ? config.h3MaxOptions?.promptExpansionMode || 'balanced' : config.videoPromptExpansionMode,
    };
    onChange(isH3 ? normalizeH3MaxDraft(nextConfig) : nextConfig);
  };

  const updateH3Mode = (h3MaxMode: H3MaxSelection) => {
    if (!H3_MAX_MODE_OPTIONS.some(option => option.value === h3MaxMode)) return;
    setGenerationError(null);
    // Preserve media and the written brief. Unsupported references remain
    // visible with an actionable validation message instead of being deleted.
    onChange(current => normalizeH3MaxDraft({ ...current, h3MaxMode, videoOperation: 'generate' }));
  };

  const updateVideoOperation = (intent: VideoPromptIntent) => {
    const videoOperation: VideoOperation = intent === 'continue' ? 'generate' : intent;
    const continuationId = intent === 'continue'
      ? currentReferenceVideos.find(video => video.isContinuation)?.id || currentReferenceVideos[0]?.id
      : undefined;
    onChange({
      ...config,
      videoOperation,
      referenceVideos: currentReferenceVideos.map(video => ({ ...video, isContinuation: video.id === continuationId })),
      videoAspectRatio: videoOperation === 'edit' || videoOperation === 'extend' ? 'adaptive' : config.videoAspectRatio,
      videoDuration: videoOperation === 'edit' ? -1 : config.videoDuration,
    });
  };

  const processImageFiles = async (files: (File | Blob)[]) => {
      setAttachmentError(null);
      const MAX_IMAGES = maxReferenceImages;
      const MAX_SIZE_BYTES = 1024 * 1024; // 1MB threshold for compression
      const currentImages = config.referenceImages || [];
      const remainingSlots = Math.max(0, MAX_IMAGES - currentImages.length);

      if (files.length > remainingSlots) {
        setAttachmentError(`Limit reached: ${MAX_IMAGES} images max.`);
      }

      const filesToProcess = files.slice(0, remainingSlots);
      const newImages: ReferenceImage[] = [];

      for (const file of filesToProcess) {
          let data = await readFileAsBase64(file);
          const name = (file as File).name;
          let mimeType = getMimeType(file, name);

          // Keep image-edit sources intact, including imports made before the
          // user switches from Nano Banana to Sunburst. Image generation sends
          // storage URLs; text Enhance/Brainstorm resize their own request copies.
          // Video references retain the existing import-size optimization.
          const estimatedSize = estimateBase64Size(data);
          if (config.mode !== 'image' && estimatedSize > MAX_SIZE_BYTES) {
            try {
              data = await compressImage(data, 1536, 0.85);
              mimeType = 'image/jpeg';
            } catch (e) {
              console.warn("Image compression failed, using original", e);
            }
          }

          newImages.push({
            id: Math.random().toString(36).substr(2, 9),
            data,
            mimeType
          });
      }

      if (newImages.length > 0) {
        // Merge into the latest draft: reading/compressing the files awaited,
        // and edits, other attachments or a model change may have landed meanwhile.
        // flushSync applies the update now, so the warning reflects what it kept.
        let dropped = 0;
        flushSync(() => onChange(prev => {
          const refs = prev.referenceImages || [];
          const kept = newImages.slice(0, Math.max(0, attachLimitsRef.current.images - refs.length));
          dropped = newImages.length - kept.length;
          return { ...prev, referenceImages: [...refs, ...kept] };
        }));
        if (dropped) setAttachmentError(`Limit reached: ${attachLimitsRef.current.images} images max.`);
      }
  };

  // --- Upload Handlers ---
  const handleRefImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      await processImageFiles(Array.from(e.target.files));
      if (refInputRef.current) refInputRef.current.value = '';
    }
  };

  const processVideoFiles = async (files: File[], switchToVideo = false) => {
    if (files.length === 0) return;
    setAttachmentError(null);
    const isInsert = isH3VideoConfig && h3State.mode === 'insert_video';
    const sourceId = isInsert ? currentReferenceVideos[0]?.id : undefined;
    const needsSource = isInsert && !sourceId;
    if (needsSource && insertSourceUploadRef.current) {
      addAttachmentError('Wait for the Insert source video to finish uploading before adding more clips.');
      return;
    }
    if (isH3VideoConfig && h3State.mode === 'insert_video' && currentReferenceVideos.length === 0 && files[0].size > 50 * 1024 * 1024) {
      // Dropping the first file would turn a supplemental reference into the
      // source. Keep the entire selection untouched until its source is valid.
      setAttachmentError(`${files[0].name || 'Video'} exceeds the 50 MB H3 Max Insert source limit. Add a valid source first.`);
      return;
    }
    if (isH3VideoConfig && h3State.mode === 'extend_video') {
      const oversized = files.filter(file => file.size > 50 * 1024 * 1024);
      if (oversized.length) setAttachmentError(`${oversized.map(file => file.name || 'Video').join(', ')} exceeds the 50 MB H3 Max Extend source limit.`);
      files = files.filter(file => file.size <= 50 * 1024 * 1024);
      if (!files.length) return;
    }
    if (needsSource) insertSourceUploadRef.current = true;
    setUploadingReferenceVideos(count => count + files.length);
    try {
      const results: PromiseSettledResult<ReferenceVideo>[] = [];
      if (needsSource) {
        // Supplemental clips must never become the source after its upload fails.
        const source = await Promise.allSettled([uploadReferenceVideo(files[0], isH3VideoConfig)]);
        if (source[0].status === 'rejected') {
          setAttachmentError(source[0].reason instanceof Error ? source[0].reason.message : 'Source video upload failed.');
          return;
        }
        results.push(...source);
      }
      results.push(...await Promise.allSettled(files.slice(needsSource ? 1 : 0).map(file => uploadReferenceVideo(file, isH3VideoConfig))));
      const newRefs = results.flatMap(result => result.status === 'fulfilled' ? [result.value] : []);
      const failures = results.flatMap(result =>
        result.status === 'rejected'
          ? [result.reason instanceof Error ? result.reason.message : 'Video upload failed.']
          : []
      );

      let dropped = 0, sourceChanged = false;
      if (newRefs.length > 0) {
        // Never exceed the latest limit (the operation may have changed while uploading),
        // even if another selection finished first. flushSync applies the update now,
        // so the warning reflects what it kept.
        flushSync(() => onChange(previous => {
          if (isInsert && (sourceId ? previous.referenceVideos?.[0]?.id !== sourceId : previous.referenceVideos?.length)) {
            sourceChanged = true;
            return previous;
          }
          const kept = newRefs.slice(0, Math.max(0, attachLimitsRef.current.videos - (previous.referenceVideos?.length || 0)));
          dropped = newRefs.length - kept.length;
          return {
            ...previous,
            referenceVideos: [...(previous.referenceVideos || []), ...kept],
            ...(switchToVideo ? { mode: 'video' as const } : {}),
          };
        }));
      }
      if (failures.length > 0) {
        setAttachmentError(failures.join('\n'));
      }
      if (sourceChanged) addAttachmentError('The Insert source video changed while uploading. Add the clips again for the current source.');
      if (dropped) addAttachmentError(`Limit reached: ${attachLimitsRef.current.videos} videos max.`);
    } finally {
      if (needsSource) insertSourceUploadRef.current = false;
      setUploadingReferenceVideos(count => Math.max(0, count - files.length));
    }
  };

  // Several attachment problems in one action are all shown.
  const addAttachmentError = (message: string) => setAttachmentError(previous => previous?.includes(message) ? previous : previous ? `${previous} ${message}` : message);

  const handleVideoFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return;
    if (isH3VideoConfig && maxReferenceVideos === 0) {
      setAttachmentError('Choose an H3 Max action that accepts videos before adding a video.');
      if (videoInputRef.current) videoInputRef.current.value = '';
      return;
    }
    const MAX_VIDEOS = maxReferenceVideos;
    // Videos still uploading from an earlier selection already hold their slots.
    const current = (config.referenceVideos?.length || 0) + uploadingReferenceVideos;
    // A model switch can leave more inputs than the new limit; never slice with a negative end.
    const room = Math.max(0, MAX_VIDEOS - current);
    const picked = Array.from(e.target.files) as File[];
    await processVideoFiles(picked.slice(0, room));
    // After processing (which clears earlier errors), keeping any upload error it reported.
    if (picked.length > room) addAttachmentError(`Limit reached: ${MAX_VIDEOS} videos max.`);
    if (videoInputRef.current) videoInputRef.current.value = '';
  };

  const processAudioFiles = async (files: File[], switchToVideo = false) => {
    const MAX_AUDIOS = maxReferenceAudios;
    const room = Math.max(0, MAX_AUDIOS - (config.referenceAudios?.length || 0));
    const validFiles = files.filter(file => {
      if (getMimeType(file, file.name).startsWith('audio/')) return true;
      addAttachmentError(`${file.name || 'Audio'} must be an audio file.`);
      return false;
    });
    if (validFiles.length > room) addAttachmentError(`Limit reached: ${MAX_AUDIOS} audio clips max.`);
    const toAdd = validFiles.slice(0, room);
    if (toAdd.length === 0) return;
    const newRefs = await Promise.all(toAdd.map(async file => {
      const url = URL.createObjectURL(file);
      return {
        id: Math.random().toString(36).substr(2, 9),
        url,
        mimeType: getMimeType(file, file.name),
        name: file.name,
        size: file.size,
        duration: await readAudioDuration(url),
      };
    }));
    // Reading durations can take seconds; merge into the latest draft and its latest limit.
    let cut: typeof newRefs = [];
    flushSync(() => onChange(previous => {
      const audios = previous.referenceAudios || [];
      const kept = newRefs.slice(0, Math.max(0, attachLimitsRef.current.audios - audios.length));
      cut = newRefs.slice(kept.length);
      return {
        ...previous,
        referenceAudios: [...audios, ...kept],
        ...(switchToVideo ? { mode: 'video' as const } : {}),
      };
    }));
    // Cut clips never reached the draft: release their object URLs and report them.
    cut.forEach(ref => URL.revokeObjectURL(ref.url));
    if (cut.length) addAttachmentError(`Limit reached: ${attachLimitsRef.current.audios} audio clips max.`);
  };

  const handleAudioFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return;
    setAttachmentError(null);
    if (isH3VideoConfig && maxReferenceAudios === 0) {
      setAttachmentError('Choose an H3 Max action that accepts audio before adding an audio clip.');
      if (audioInputRef.current) audioInputRef.current.value = '';
      return;
    }
    await processAudioFiles(Array.from(e.target.files) as File[]);
    if (audioInputRef.current) audioInputRef.current.value = '';
  };

  const handleEnhance = async () => {
    if (isDraftLoading) return;
    if (isEnhancing || hasStaleEnhancedPrompt || !hasEnhanceInput) return;
    const originalPrompt = preEnhancePrompt ?? config.prompt;
    const enhancementTarget = getPromptEnhancementTarget(config);
    setEnhanceError(null);
    setEnhanceStage('preparing');
    setIsEnhancing(true);
    try {
      const textOptions = { ...await resolveTextModelPreferences(), onStage: setEnhanceStage };
      setEnhanceModelLabel(getTextModelLabel(textOptions.model));
      let enhanced: string;
      if (config.mode === 'video') {
        const continuationVideo = config.videoOperation === 'extend'
          ? config.referenceVideos?.[0]
          : getVideoPromptIntent(config) === 'continue'
            ? (config.referenceVideos || []).find(v => v.isContinuation)
            : undefined;
        const prevPromptContext = continuationVideo?.previousPrompt || '';
        const promptToEnhance = prevPromptContext
          ? `[PREVIOUS SHOT CONTEXT: ${prevPromptContext}]\n\n[NEW SHOT IDEA: ${config.prompt}]`
          : config.prompt;
        enhanced = await enhanceVideoPrompt(
          promptToEnhance,
          config.referenceImages,
          (config.videoOperation || 'generate') === 'edit' ? -1 : config.videoDuration,
          config.videoModel || DEFAULT_VIDEO_MODEL,
          config.videoOperation || 'generate',
          config.referenceVideos || [],
          config.referenceAudios || [],
          textOptions,
          isH3VideoConfig ? { mode: h3State.mode, options: config.h3MaxOptions } : undefined,
        );
      } else {
        enhanced = await enhancePrompt(config.prompt, config.referenceImages, config, textOptions);
      }
      // A slow Enhance response must never undo a newer draft, action, or
      // reference-role choice. Dimension-only price updates are safe, and
      // their decoded metadata must survive the enhanced prompt update.
      const enhancementDraft = latestConfigRef.current;
      if (enhancementDraft !== config && !(isH3VideoConfig && isH3MetadataOnlyUpdate(config, enhancementDraft))) {
        setEnhanceError('Enhance sırasında prompt veya ayarlar değişti. Güncel seçimler için yeniden Enhance yap.');
        return;
      }
      if (enhanced) {
        onChange({
          ...enhancementDraft,
          ...enhancementTarget,
          prompt: enhanced,
          originalPrompt,
          promptPreparation: createPromptPreparation('enhance', textOptions),
        });
      }
    } catch (e) {
      console.error("Failed to enhance", e);
      setEnhanceError(e instanceof Error ? e.message : 'Prompt Enhance başarısız oldu. Tekrar dene.');
    } finally {
      setIsEnhancing(false);
    }
  };

  const handleRevertEnhancedPrompt = () => {
    if (!h3PromptSupported) return;
    const originalPrompt = config.originalPrompt ?? preEnhancePrompt;
    if (originalPrompt == null) return;
    onChange({
      ...config,
      prompt: originalPrompt,
      originalPrompt: undefined,
      promptPreparation: undefined,
      enhancedForMode: undefined,
      enhancedForImageModel: undefined,
      enhancedForImageContextKey: undefined,
      enhancedForVideoModel: undefined,
      enhancedForVideoOperation: undefined,
      enhancedForVideoReferenceKey: undefined,
      enhancedForH3MaxMode: undefined,
      enhancedForH3MaxOptionsKey: undefined,
    });
    setEnhanceError(null);
  };

  const handleClearAll = () => {
    if (config.prompt || config.referenceImages.length > 0 || config.personGroups?.length || (config.referenceVideos?.length || 0) > 0 || (config.referenceAudios?.length || 0) > 0) {
        setUndoStack(prev => [...prev.slice(-9), { images: [...config.referenceImages], prompt: config.prompt, imagePromptCategory: config.imagePromptCategory, promptPreparation: config.promptPreparation, youtubeSource: config.youtubeSource, personGroups: getPersonDefinitions(config), h3MaxOptions: config.h3MaxOptions, clearedConfig: config }]);
        onChange({
          ...config,
          prompt: '',
          imagePromptCategory: undefined,
          youtubeSource: undefined,
          originalPrompt: undefined,
          promptPreparation: undefined,
          enhancedForMode: undefined,
          enhancedForImageModel: undefined,
          enhancedForImageContextKey: undefined,
          enhancedForVideoModel: undefined,
          enhancedForVideoOperation: undefined,
          enhancedForVideoReferenceKey: undefined,
          enhancedForH3MaxMode: undefined,
          enhancedForH3MaxOptionsKey: undefined,
          h3MaxOptions: config.h3MaxOptions ? { ...config.h3MaxOptions, startImageId: undefined, middleImageId: undefined, endImageId: undefined, startImageUrl: undefined, middleImageUrl: undefined, endImageUrl: undefined, middleFrameTime: undefined } : undefined,
          referenceImages: [],
          personGroups: [],
          referenceVideos: [],
          referenceAudios: [],
        });
        setEnhanceError(null);
        if (refInputRef.current) refInputRef.current.value = '';
    }
  };

  const handleRemoveImage = (imageId: string) => {
    const removedImage = config.referenceImages.find(img => img.id === imageId);
    if (!removedImage) return;
    const personId = getPersonId(removedImage);
    const images = config.referenceImages.filter(image => personId != null ? getPersonId(image) === personId : image.id === imageId);
    const removedIds = new Set<string>(images.map(image => image.id));
    const definitions = getPersonDefinitions(config);
    setUndoStack(prev => [...prev.slice(-9), {
      images,
      positions: images.map(image => config.referenceImages.indexOf(image)),
      personGroups: personId != null ? definitions.filter(group => group.id === personId) : undefined,
      h3MaxOptions: config.h3MaxOptions,
    }]);
    // This edits only the current draft. Saved People and their photos remain intact.
    onChange(prev => ({ ...(isH3VideoConfig ? removeH3MaxReferenceImages(prev, removedIds) : prev),
      ...(!isH3VideoConfig ? { referenceImages: prev.referenceImages.filter(image => !removedIds.has(image.id)) } : {}),
      personGroups: personId != null ? getPersonDefinitions(prev).filter(group => group.id !== personId) : prev.personGroups,
    }));
  };

  const handleUndo = () => {
    if (undoStack.length === 0) return;
    const lastEntry = undoStack[undoStack.length - 1];
    const updatedConfig = { ...config };
    if (lastEntry.clearedConfig) {
      const cleared = lastEntry.clearedConfig;
      const videos = [...(config.referenceVideos || [])];
      (cleared.referenceVideos || []).forEach((video, index) => {
        if (!videos.some(current => current.id === video.id)) videos.splice(index, 0, video);
      });
      const audios = [...(config.referenceAudios || [])];
      (cleared.referenceAudios || []).forEach((audio, index) => {
        if (!audios.some(current => current.id === audio.id)) audios.splice(index, 0, audio);
      });
      Object.assign(updatedConfig, {
        referenceVideos: videos,
        referenceAudios: audios,
        originalPrompt: cleared.originalPrompt,
        enhancedForMode: cleared.enhancedForMode,
        enhancedForImageModel: cleared.enhancedForImageModel,
        enhancedForImageContextKey: cleared.enhancedForImageContextKey,
        enhancedForVideoModel: cleared.enhancedForVideoModel,
        enhancedForVideoOperation: cleared.enhancedForVideoOperation,
        enhancedForVideoReferenceKey: cleared.enhancedForVideoReferenceKey,
        enhancedForH3MaxMode: cleared.enhancedForH3MaxMode,
        enhancedForH3MaxOptionsKey: cleared.enhancedForH3MaxOptionsKey,
      });
    }
    if (lastEntry.images.length > 0) {
      const restored = [...config.referenceImages];
      lastEntry.images.forEach((image, index) => {
        if (restored.some(current => current.id === image.id)) return;
        restored.splice(lastEntry.positions?.[index] ?? restored.length, 0, image);
      });
      updatedConfig.referenceImages = restored;
    }
    if (lastEntry.prompt !== undefined) {
      updatedConfig.prompt = lastEntry.prompt;
      updatedConfig.imagePromptCategory = lastEntry.imagePromptCategory;
      updatedConfig.promptPreparation = lastEntry.promptPreparation;
      updatedConfig.youtubeSource = lastEntry.youtubeSource;
    }
    if (Object.hasOwn(lastEntry, 'h3MaxOptions')) updatedConfig.h3MaxOptions = lastEntry.h3MaxOptions;
    if (lastEntry.personGroups) {
      updatedConfig.personGroups = getPersonDefinitions({ referenceImages: updatedConfig.referenceImages, personGroups: [...(config.personGroups || []), ...lastEntry.personGroups] });
    }
    if (lastEntry.clearedConfig) {
      // Auto H3 actions resolve from the restored inputs, not the empty draft.
      const restoredH3 = isH3VideoConfig ? getH3MaxUIState(updatedConfig) : null;
      const videoLimit = restoredH3 ? (restoredH3.available ? restoredH3.capabilities.videos.max : 0) : maxReferenceVideos;
      const audioLimit = restoredH3 ? (restoredH3.available ? restoredH3.capabilities.audios.max : 0) : maxReferenceAudios;
      const imageLimit = getReferenceImageLimit(updatedConfig);
      if (updatedConfig.referenceImages.length > imageLimit
        || (updatedConfig.referenceVideos?.length || 0) > videoLimit
        || (updatedConfig.referenceAudios?.length || 0) > audioLimit) {
        setAttachmentError('Could not undo Clear: the current action has no room for the previous media references. Remove references or choose the previous action, then try Undo again.');
        return;
      }
      setAttachmentError(null);
    }
    setUndoStack(prev => prev.slice(0, -1));
    onChange(updatedConfig);
  };

  // --- Template Handlers ---
  const handleToggleTemplateMenu = () => {
      if (!isTemplateMenuOpen && templateButtonRef.current) {
          const rect = templateButtonRef.current.getBoundingClientRect();
          setTemplateMenuPos({
              bottom: window.innerHeight - rect.top + 8,
              left: rect.left
          });
      }
      setIsTemplateMenuOpen(!isTemplateMenuOpen);
      setIsNamingTemplate(false);
      setNewTemplateName('');
  };

  const handleSaveClick = () => {
      setIsNamingTemplate(true);
  };

  const handleConfirmSave = () => {
      if (newTemplateName.trim()) {
          onSaveTemplate(newTemplateName);
          setNewTemplateName('');
          setIsNamingTemplate(false);
          setIsTemplateMenuOpen(false);
      }
  };

  // Click outside listener for template menu
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        isTemplateMenuOpen &&
        templateButtonRef.current && !templateButtonRef.current.contains(target) &&
        templateMenuRef.current && !templateMenuRef.current.contains(target)
      ) {
        setIsTemplateMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isTemplateMenuOpen]);

  // --- Brainstorm Handlers ---
  const handleToggleBrainstormPanel = () => {
    if (!isBrainstormPanelOpen && brainstormButtonRef.current) {
      const rect = brainstormButtonRef.current.getBoundingClientRect();
      setBrainstormPanelPos({
        bottom: window.innerHeight - rect.top + 8,
        left: Math.max(16, rect.left - 150) // Center the panel a bit
      });
    }
    setIsBrainstormPanelOpen(!isBrainstormPanelOpen);
  };

  const sunburstError = config.imageModel === SUNBURST_MODEL && config.mode === 'image' && (
    validateOpenAIImageOptions(getOpenAIImageOptions(config.openaiImageOptions))
    || validateOpenAIImageSize(getOpenAIImageSize(config))
    || (config.referenceImages.length > 16 ? 'Sunburst accepts up to 16 reference images.' : null)
  );
  const hasBrainstormInput = brainstormCategory === 'simple' || config.youtubeSource
    ? Boolean(config.prompt.trim() || config.referenceImages.length) : config.referenceImages.length > 0;
  // Like Generate: a Re-create's saved references must finish loading first.
  const canBrainstormGenerate = config.mode === 'image' && !isDraftLoading && Boolean(onBrainstormGenerate && !sunburstError && hasBrainstormInput);
  const isBrainstormActive = config.mode === 'image' && isBrainstormPanelOpen && !isMinimized;

  const handleBrainstorm = async () => {
    if (!canBrainstormGenerate || brainstormSubmitRef.current || !onBrainstormGenerate) return;
    brainstormSubmitRef.current = true;
    setBrainstormError(null);
    try {
      const pendingPreferences = resolveTextModelPreferences();
      const preferences = pendingPreferences instanceof Promise ? await pendingPreferences : pendingPreferences;
      onBrainstormGenerate({ settings: config, category: brainstormCategory, ideaCount: brainstormIdeaCount,
        textModel: preferences.model, reasoningEffort: preferences.reasoningEffort, thinkingLevel: preferences.thinkingLevel });
    } catch (error) {
      setBrainstormError(error instanceof Error ? error.message : 'Could not start Brainstorm.');
    } finally {
      // Prevent two click callbacks in the same render from launching twice.
      queueMicrotask(() => { brainstormSubmitRef.current = false; });
    }
  };

  const handleYouTubeBrainstorm = (prepared: YouTubeBrainstormPreparation) => {
    const next = prepareYouTubeBrainstormDraft(latestConfigRef.current, prepared);
    onChange({ ...next, promptPreparation: undefined });
    setBrainstormCategory('youtube_thumbnail');
    setBrainstormError(null);
    setEnhanceError(null);
    setIsMinimized(false);
    if (brainstormButtonRef.current) {
      const rect = brainstormButtonRef.current.getBoundingClientRect();
      setBrainstormPanelPos({ bottom: window.innerHeight - rect.top + 8, left: Math.max(16, Math.min(rect.left - 150, window.innerWidth - 416)) });
    }
    setIsBrainstormPanelOpen(true);
  };

  const handleToggleFirstFrame = (imageId: string) => {
    onChange({
      ...config,
      referenceImages: config.referenceImages.map(img =>
        img.id === imageId
          ? { ...img, isFirstFrame: !img.isFirstFrame, isLastFrame: false, isSubjectImage: false, isSecondPerson: false, personId: undefined, personName: undefined }
          : { ...img, isFirstFrame: false }
      )
    });
  };

  const handleH3ImageRole = (imageId: string, role: H3MaxImageRole) => {
    setGenerationError(null);
    onChange(current => setH3MaxImageRole(current, imageId, role));
    closeRefPopover();
  };

  const handleToggleLastFrame = (imageId: string) => {
    onChange({
      ...config,
      referenceImages: config.referenceImages.map(img =>
        img.id === imageId
          ? { ...img, isLastFrame: !img.isLastFrame, isFirstFrame: false, isSubjectImage: false, isSecondPerson: false, personId: undefined, personName: undefined }
          : { ...img, isLastFrame: false }
      )
    });
  };

  // Reference Gallery Handlers
  const handleDragStart = (e: React.DragEvent, refImage: ReferenceImage, index: number) => {
    setDraggedRefId(refImage.id);
    e.dataTransfer.effectAllowed = 'copy';
    e.dataTransfer.setData('text/plain', config.mode === 'image' ? displayPrompt(getPersonId(refImage) != null ? getPersonTag(getPersonId(refImage)!) : getStableImageTag(refImage.id)) : getPersonId(refImage) && config.videoModel !== 'minimax-h3' ? getPersonTag(getPersonId(refImage)!) : `@REF_IMAGE_${index + 1}`);
    e.dataTransfer.setData('application/nanogen-ref-id', refImage.id);
  };

  const handleDragEnd = () => {
    setDraggedRefId(null);
    setIsDraggingToGallery(false);
  };

  const handleGalleryDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    // Accept drags from: ref bar images, main gallery images
    const isRefBarDrag = e.dataTransfer.types.includes('application/nanogen-ref-id') || e.dataTransfer.types.includes('text/plain');
    const isGalleryDrag = e.dataTransfer.types.includes('application/nanogen-media');
    if (isRefBarDrag || isGalleryDrag) {
      e.dataTransfer.dropEffect = 'copy';
      setIsDraggingToGallery(true);
    }
  };

  const handleGalleryDragLeave = () => {
    setIsDraggingToGallery(false);
  };

  const handleGalleryItemDragStart = (e: React.DragEvent, savedImage: SavedReferenceImage) => {
    // Set data for dragging from gallery to main bar
    e.dataTransfer.effectAllowed = 'copy';
    e.dataTransfer.setData('application/nanogen-saved-ref', JSON.stringify(savedImage));
    // Also store in state since dataTransfer from portals can be unreliable
    setDraggedGalleryItem(savedImage);
    setIsDraggingSavedRef(true);
  };

  const handleGalleryItemDragEnd = () => {
    setDraggedGalleryItem(null);
    setIsDraggingSavedRef(false);
  };

  const handleGalleryDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingToGallery(false);
    
    // 1. Handle drop from reference bar (internal refs)
    const draggedId = e.dataTransfer.getData('application/nanogen-ref-id') || e.dataTransfer.getData('text/plain');
    const refImage = config.referenceImages.find(img => img.id === draggedId);
    
    if (refImage) {
      // Check if already in gallery
      const existsInGallery = refGallery.some(img => img.data === refImage.data);
      if (existsInGallery) {
        return; // Already saved
      }
      
      const savedImage: SavedReferenceImage = {
        id: `saved-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        data: refImage.data,
        mimeType: refImage.mimeType,
        createdAt: Date.now()
      };
      
      try {
        const saved = await saveReferenceImage(savedImage, refGallery);
        setRefGallery(prev => prev.some(image => image.id === saved.id) ? prev : [saved, ...prev]);
      } catch (error) { setGenerationError(error instanceof Error ? error.message : 'Could not save reference.'); }
      return;
    }
    
    // 2. Handle drop from main Gallery (generated images)
    const mediaData = e.dataTransfer.getData('application/nanogen-media');
    if (mediaData) {
      try {
        const media = JSON.parse(mediaData);
        // Fetch the image and convert to base64
        const response = await fetch(media.url);
        if (!response.ok) throw new Error(`Gallery image download failed (${response.status})`);
        const blob = await response.blob();
        if (!blob.size || /^(?:text\/|application\/json)/i.test(blob.type)) throw new Error('Gallery image download did not return an image.');
        const reader = new FileReader();
        reader.onload = async () => {
          const base64 = reader.result as string;
          
          // Check if already in gallery
          const existsInGallery = refGallery.some(img => img.data === base64);
          if (existsInGallery) return;
          
          const savedImage: SavedReferenceImage = {
            id: `saved-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            data: base64,
            mimeType: blob.type || 'image/png',
            createdAt: Date.now()
          };
          
          try {
            const saved = await saveReferenceImage(savedImage);
            setRefGallery(prev => [saved, ...prev]);
          } catch (error) { setGenerationError(error instanceof Error ? error.message : 'Could not save reference.'); }
        };
        reader.readAsDataURL(blob);
      } catch (error) {
        console.error("Failed to save gallery image to references", error);
      }
    }
  };

  const handleAddFromGallery = (savedImage: SavedReferenceImage) => {
    const MAX_IMAGES = maxReferenceImages;
    if ((config.referenceImages?.length || 0) >= MAX_IMAGES) {
      setAttachmentError(`Limit reached: ${MAX_IMAGES} images max.`);
      return;
    }

    // Check if already added
    const existsInRefs = config.referenceImages.some(img => img.data === savedImage.data);
    if (existsInRefs) {
      // Optional: Visual feedback for duplicate

      return; // Already added
    }

    const newRef: ReferenceImage = {
      id: Math.random().toString(36).substr(2, 9),
      data: savedImage.data,
      mimeType: savedImage.mimeType
    };
    
    onChange({
      ...config,
      referenceImages: [...config.referenceImages, newRef]
    });
  };

  const handleDeleteFromGallery = async (id: string) => {
    await deleteReferenceImage(id);
    setRefGallery(prev => prev.filter(img => img.id !== id));
  };

  // Click outside listener for brainstorm panel
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        isBrainstormPanelOpen &&
        brainstormButtonRef.current && !brainstormButtonRef.current.contains(target) &&
        brainstormPanelRef.current && !brainstormPanelRef.current.contains(target)
      ) {
        setIsBrainstormPanelOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isBrainstormPanelOpen]);

  // Click outside listener for reference gallery
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      // Check if click is outside BOTH the trigger button and the dropdown portal
      if (
        isRefGalleryOpen &&
        refGalleryRef.current && !refGalleryRef.current.contains(target) &&
        galleryDropdownRef.current && !galleryDropdownRef.current.contains(target)
      ) {
        setIsRefGalleryOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isRefGalleryOpen]);

  // Handle clipboard paste for images
  const handlePaste = async (e: React.ClipboardEvent) => {
    const imageFiles = getClipboardImages(e.clipboardData);
    
    if (imageFiles.length > 0) {
      e.preventDefault(); // Prevent default paste behavior for images
      await processImageFiles(imageFiles);
    }
  };

  // --- Drag and Drop Handlers ---
  const handleDragOver = (e: React.DragEvent) => {
    // If dragging an internal reference image over the textarea, let native behavior handle it (inserts text)
    if (draggedRefId && e.target instanceof HTMLTextAreaElement) {
        return;
    }
    
    e.preventDefault();
    // Only show overlay for external file drops
    if (draggedRefId) return; // Internal ref image drag
    
    // Check for saved ref drag (state-based detection is more reliable for portals)
    if (draggedGalleryItem || e.dataTransfer.types.includes('application/nanogen-saved-ref')) {
        e.dataTransfer.dropEffect = 'copy';
        setIsDraggingSavedRef(true);
        return;
    }
    
    // Check if it's external files (not internal drag)
    const hasFiles = e.dataTransfer.types.includes('Files');
    const hasGalleryMedia = e.dataTransfer.types.includes('application/nanogen-media');
    
    if (hasFiles || hasGalleryMedia) {
    setIsDragging(true);
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setIsDragging(false);
    setIsDraggingSavedRef(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    // If dropping an internal reference onto the textarea, let native text insertion happen
    if (draggedRefId && e.target instanceof HTMLTextAreaElement) {
        setIsDragging(false);
        setIsDraggingSavedRef(false);
        return; 
    }

    e.preventDefault();
    setIsDragging(false);
    setIsDraggingSavedRef(false);

    // Skip if this was an internal ref-to-gallery drag
    if (draggedRefId) return;

    // Handle Drop from Reference Gallery -> Main Bar (use state as primary, dataTransfer as fallback)
    if (draggedGalleryItem) {
        handleAddFromGallery(draggedGalleryItem);
        setDraggedGalleryItem(null);
        return;
    }
    
    // Fallback: try dataTransfer (might work in some browsers)
    const savedRefData = e.dataTransfer.getData('application/nanogen-saved-ref');
    if (savedRefData) {
        try {
            const savedImage = JSON.parse(savedRefData);
            handleAddFromGallery(savedImage);
        } catch (error) {
            console.error("Failed to process dropped saved ref", error);
        }
        return;
    }

    // 1. Handle Desktop Files
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        const allFiles = Array.from(e.dataTransfer.files) as File[];
        const imageFiles = allFiles.filter(f => f.type.startsWith('image/'));
        const videoFiles = allFiles.filter(f => f.type.startsWith('video/') || (!f.type && /\.(mp4|mov|webm)$/i.test(f.name)));
        const audioFiles = allFiles.filter(f => f.type.startsWith('audio/')
          || (!f.type.startsWith('video/') && /\.(mp3|wav|m4a|aac|ogg|oga|flac|aif|aiff)$/i.test(f.name)));

        if (imageFiles.length > 0) {
            await processImageFiles(imageFiles);
        }

        if (videoFiles.length > 0) {
            if (isH3VideoConfig && maxReferenceVideos === 0) {
                setAttachmentError('Choose an H3 Max action that accepts videos before adding a video.');
            } else {
                const MAX_VIDEOS = maxReferenceVideos;
                const current = (config.referenceVideos?.length || 0) + uploadingReferenceVideos;
                const room = Math.max(0, MAX_VIDEOS - current);
                const toAdd = videoFiles.slice(0, room);
                if (toAdd.length > 0) {
                    await processVideoFiles(toAdd, true);
                }
                if (videoFiles.length > room) addAttachmentError(`Limit reached: ${MAX_VIDEOS} videos max.`);
            }
        }

        if (audioFiles.length > 0) {
            if (isH3VideoConfig && maxReferenceAudios === 0) {
                setAttachmentError('Choose an H3 Max action that accepts audio before adding an audio clip.');
            } else {
                await processAudioFiles(audioFiles, true);
            }
        }
        return;
    }

    // 2. Handle Gallery Drops
    const rawData = e.dataTransfer.getData('application/nanogen-media');
    if (rawData) {
        try {
            const media = JSON.parse(rawData);
            if (media.mediaType === 'video' && media.url) {
              if (isH3VideoConfig && maxReferenceVideos === 0) {
                setAttachmentError('Choose an H3 Max action that accepts videos before adding a video.');
                return;
              }
              const MAX_VIDEOS = maxReferenceVideos;
              if ((config.referenceVideos?.length || 0) >= MAX_VIDEOS) {
                setAttachmentError(`Maximum of ${MAX_VIDEOS} videos allowed for the selected action.`);
                return;
              }
              onChange({
                ...config,
                referenceVideos: [
                  ...(config.referenceVideos || []),
                  { id: Math.random().toString(36).substr(2, 9), url: media.url, mimeType: 'video/mp4', duration: media.videoDuration }
                ],
                mode: 'video',
              });
              return;
            }
            const response = await fetch(media.url);
            if (!response.ok) throw new Error(`Gallery image download failed (${response.status})`);
            const blob = await response.blob();
            if (!blob.size || /^(?:text\/|application\/json)/i.test(blob.type)) throw new Error('Gallery image download did not return an image.');
            await processImageFiles([blob]);
        } catch (error) {
            console.error("Failed to process dropped gallery item", error);
        }
    }
  };

  // --- Prompt Resize Handlers ---
  const clampPromptHeight = (height: number): number => {
    const viewportLimit = typeof window === 'undefined'
      ? MAX_PROMPT_HEIGHT
      : Math.max(MIN_PROMPT_HEIGHT, window.innerHeight - 280);
    return Math.max(MIN_PROMPT_HEIGHT, Math.min(MAX_PROMPT_HEIGHT, viewportLimit, height));
  };

  const handlePromptResizeStart = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    promptResizeRef.current = { pointerId: e.pointerId, lastY: e.clientY };
    setIsResizingPrompt(true);
  };

  const handlePromptResizeMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const resize = promptResizeRef.current;
    if (!resize || resize.pointerId !== e.pointerId) return;
    e.preventDefault();
    const delta = resize.lastY - e.clientY;
    resize.lastY = e.clientY;
    setPromptHeight(current => clampPromptHeight(current + delta));
  };

  const handlePromptResizeEnd = (e: React.PointerEvent<HTMLButtonElement>) => {
    const resize = promptResizeRef.current;
    if (!resize || resize.pointerId !== e.pointerId) return;
    promptResizeRef.current = null;
    setIsResizingPrompt(false);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  const handlePromptResizeKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    const delta = e.key === 'ArrowUp' ? 24 : -24;
    setPromptHeight(current => clampPromptHeight(current + delta));
  };

  useEffect(() => {
    if (!isResizingPrompt) return;
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = 'ns-resize';
    document.body.style.userSelect = 'none';
    return () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
    };
  }, [isResizingPrompt]);

  const handleGenerate = () => {
    if (isDraftLoading) return;
    if (isBrainstormActive) return;
    setGenerationError(null);
    if (config.mode === 'image') {
      try {
        validateImageGenerationReferences(config);
      } catch (error) {
        setGenerationError(error instanceof Error ? error.message : 'Check the attached references.');
        return;
      }
    }
    if (config.mode === 'video' && config.videoModel === 'seedance-2.5' && !config.referenceVideos?.some(video => video.isContinuation)) {
      const error = getSeedanceFrameError(config.referenceImages, config.referenceVideos?.length || 0, config.referenceAudios?.length || 0, config.videoOperation);
      if (error) { setGenerationError(error); return; }
    }
    if (isH3VideoConfig) {
      const error = getH3MaxInputError(config);
      if (error) { setGenerationError(error); return; }
    }
    onGenerate();
  };

  // --- Keyboard Shortcuts ---
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.repeat || (e as any).isComposing) return;
      if (document.querySelector('[aria-modal="true"], dialog[open]')) return;
      const isMod = e.metaKey || e.ctrlKey;

      // The open Brainstorm panel owns submission, including the shortcut.
      if (isMod && e.key === 'Enter') {
        if (document.querySelector?.('[data-gallery-image-editor]')) return;
        e.preventDefault();
        if (isBrainstormActive) {
          handleBrainstorm();
          return;
        }
        if (canGenerate) {
          handleGenerate();
        }
        return;
      }

      if (e.key === 'Escape' && isBrainstormPanelOpen) {
        e.preventDefault();
        setIsBrainstormPanelOpen(false);
        return;
      }

      // Ctrl/Cmd + Shift + S → Brainstorm Simple
      if (isMod && e.shiftKey && (e.key === 's' || e.key === 'S')) {
        e.preventDefault();
        setBrainstormCategory('simple');
        if (brainstormButtonRef.current) {
          const rect = brainstormButtonRef.current.getBoundingClientRect();
          setBrainstormPanelPos({
            bottom: window.innerHeight - rect.top + 8,
            left: Math.max(16, rect.left - 150)
          });
        }
        setIsBrainstormPanelOpen(true);
        return;
      }

      // Ctrl/Cmd + Shift + Y → Brainstorm YouTube
      if (isMod && e.shiftKey && (e.key === 'y' || e.key === 'Y')) {
        e.preventDefault();
        setBrainstormCategory('youtube_thumbnail');
        if (brainstormButtonRef.current) {
          const rect = brainstormButtonRef.current.getBoundingClientRect();
          setBrainstormPanelPos({
            bottom: window.innerHeight - rect.top + 8,
            left: Math.max(16, rect.left - 150)
          });
        }
        setIsBrainstormPanelOpen(true);
        return;
      }

      // Ctrl/Cmd + Shift + E → Enhance
      if (isMod && e.shiftKey && (e.key === 'e' || e.key === 'E')) {
        e.preventDefault();
        if (hasEnhanceInput && !isEnhancing) {
          handleEnhance();
        }
        return;
      }

      // Ctrl/Cmd + Z → Undo reference removal or Clear (outside text inputs)
      if (isMod && (e.key === 'z' || e.key === 'Z') && !e.shiftKey) {
        const activeEl = document.activeElement;
        const isInTextInput = activeEl instanceof HTMLTextAreaElement || activeEl instanceof HTMLInputElement;
        if (!isInTextInput && undoStack.length > 0) {
          e.preventDefault();
          handleUndo();
        }
        return;
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  });

  // --- Textarea Handlers ---
  const getCaretCoordinates = (element: HTMLTextAreaElement, position: number) => {
    const div = document.createElement('div');
    const computed = window.getComputedStyle(element);

    for (const prop of Array.from(computed)) {
      div.style[prop as any] = computed.getPropertyValue(prop);
    }

    div.style.position = 'absolute';
    div.style.visibility = 'hidden';
    div.style.whiteSpace = 'pre-wrap';
    div.style.wordWrap = 'break-word';

    div.textContent = element.value.substring(0, position);

    const span = document.createElement('span');
    span.textContent = element.value.substring(position) || '.';
    div.appendChild(span);

    document.body.appendChild(div);
    
    // Add scroll offset for accuracy
    const coordinates = {
      top: span.offsetTop - element.scrollTop,
      left: span.offsetLeft
    };

    document.body.removeChild(div);
    return coordinates;
  };

  const displayPrompt = (prompt: string) => config.mode === 'image' ? displayReferencePrompt(prompt, config.referenceImages, config.personGroups) : prompt;
  const storePrompt = (prompt: string) => config.mode === 'image' ? storeReferencePrompt(prompt, config.referenceImages, config.personGroups) : prompt;

  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    if (!h3PromptSupported) return;
    const value = e.target.value;
    onChange({
      ...updateImageDraftPrompt(config, storePrompt(value)),
      promptPreparation: undefined,
    });
    
    if (isKeyframeMode) {
        setMentionState(prev => prev.active ? { ...prev, active: false } : prev);
        return;
    }

    const cursorPosition = e.target.selectionStart;
    const textBeforeCursor = value.slice(0, cursorPosition);
    
    const match = textBeforeCursor.match(/(?:^|\s)@([^@\s]*)$/);
    if (match) {
        const coords = getCaretCoordinates(e.target, cursorPosition);
        setMentionState({
            active: true,
            query: match[1],
            startIndex: cursorPosition - match[1].length - 1, // the position of '@'
            position: { top: coords.top, left: coords.left }
        });
        setMentionIndex(0);
    } else {
        setMentionState(prev => prev.active ? { ...prev, active: false } : prev);
    }
  };

  const insertMention = (img: ReferenceImage, index: number) => {
    if (!h3PromptSupported) return;
    const tag = config.mode === 'image' ? getPersonId(img) != null ? getPersonTag(getPersonId(img)!) : getStableImageTag(img.id) : `@REF_IMAGE_${index + 1}`;
    const mentionText = `${displayPrompt(tag)} `;
    const currentPrompt = displayPrompt(config.prompt);
    const newPrompt = 
        currentPrompt.substring(0, mentionState.startIndex) + 
        mentionText + 
        currentPrompt.substring(textareaRef.current?.selectionStart || 0);
    
    updateConfig('prompt', storePrompt(newPrompt));
    setMentionState({ active: false, query: '', startIndex: -1, position: null });
    
    setTimeout(() => {
        if (textareaRef.current) {
            textareaRef.current.focus();
            const newPos = mentionState.startIndex + mentionText.length;
            textareaRef.current.setSelectionRange(newPos, newPos);
        }
    }, 0);
  };

  const insertGroupMention = (tag: string) => {
    if (!h3PromptSupported) return;
    const mentionText = `${displayPrompt(tag)} `;
    const currentPrompt = displayPrompt(config.prompt);
    const newPrompt =
        currentPrompt.substring(0, mentionState.startIndex) +
        mentionText +
        currentPrompt.substring(textareaRef.current?.selectionStart || 0);

    updateConfig('prompt', storePrompt(newPrompt));
    setMentionState({ active: false, query: '', startIndex: -1, position: null });

    setTimeout(() => {
        if (textareaRef.current) {
            textareaRef.current.focus();
            const newPos = mentionState.startIndex + mentionText.length;
            textareaRef.current.setSelectionRange(newPos, newPos);
        }
    }, 0);
  };

  const handleTextareaKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.defaultPrevented || e.repeat || e.nativeEvent.isComposing) return;
    if (document.querySelector('[aria-modal="true"], dialog[open]')) return;
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      if (canGenerate) {
        e.preventDefault();
        handleGenerate();
      }
      return;
    }
    if (!h3PromptSupported) return;
    if (mentionState.active && (config.referenceImages.length > 0 || (config.referenceVideos?.length || 0) > 0 || (config.referenceAudios?.length || 0) > 0)) {
        const groupMentions = findPersonMentions(config.referenceImages, mentionState.query).map(group => ({ ...group, type: 'group' as const, count: group.images.length }));
        const filteredRefs = config.referenceImages
            .map((img, index) => ({ img, index }))
            .filter(({ index }) => `REF_IMAGE_${index + 1}`.toLowerCase().includes(mentionState.query.toLowerCase()));

        const filteredVideos = (config.referenceVideos || [])
            .map((vid, index) => ({ vid, index }))
            .filter(({ index }) => `VIDEO_${index + 1}`.toLowerCase().includes(mentionState.query.toLowerCase()));

        const filteredAudios = (config.referenceAudios || [])
            .map((aud, index) => ({ aud, index }))
            .filter(({ index }) => `AUDIO_${index + 1}`.toLowerCase().includes(mentionState.query.toLowerCase()));

        const totalItems = groupMentions.length + filteredRefs.length + filteredVideos.length + filteredAudios.length;
        if (totalItems > 0) {
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                setMentionIndex(prev => (prev + 1) % totalItems);
                return;
            }
            if (e.key === 'ArrowUp') {
                e.preventDefault();
                setMentionIndex(prev => (prev - 1 + totalItems) % totalItems);
                return;
            }
            if (e.key === 'Enter' || e.key === 'Tab') {
                e.preventDefault();
                if (mentionIndex < groupMentions.length) {
                    insertGroupMention(groupMentions[mentionIndex].tag);
                } else if (mentionIndex < groupMentions.length + filteredRefs.length) {
                    const refIdx = mentionIndex - groupMentions.length;
                    insertMention(filteredRefs[refIdx].img, filteredRefs[refIdx].index);
                } else if (mentionIndex < groupMentions.length + filteredRefs.length + filteredVideos.length) {
                    const vidIdx = mentionIndex - groupMentions.length - filteredRefs.length;
                    insertGroupMention(`@VIDEO_${filteredVideos[vidIdx].index + 1}`);
                } else {
                    const audIdx = mentionIndex - groupMentions.length - filteredRefs.length - filteredVideos.length;
                    insertGroupMention(`@AUDIO_${filteredAudios[audIdx].index + 1}`);
                }
                return;
            }
            if (e.key === 'Escape') {
                e.preventDefault();
                setMentionState(prev => ({ ...prev, active: false }));
                return;
            }
        }
    }
  };

  // --- Render Helpers ---

  const imageModelOptions = IMAGE_MODEL_OPTIONS;
  const selectedVideoModel = config.videoModel || DEFAULT_VIDEO_MODEL;
  const providerRoute = useProviderRoute(config.mode === 'video' ? selectedVideoModel : config.imageModel);
  const selectedVideoOperation = config.videoOperation || 'generate';
  const selectedVideoIntent = getVideoPromptIntent(config);
  const videoModelOptions = VIDEO_MODEL_OPTIONS.map(option => option.value === 'seedance-2.5' && providerRoute.provider !== 'evolink' ? { ...option, label: 'Seedance 2.5' } : option);
  const isH3ImageToVideo = h3UsesImageFrames && config.referenceImages.length > 0;
  const isSeedance25FrameToVideo = selectedVideoModel === 'seedance-2.5'
    && selectedVideoOperation === 'generate'
    && config.referenceImages.length > 0
    && config.referenceImages.every(image => image.isFirstFrame || image.isLastFrame)
    && currentReferenceVideos.length === 0
    && (config.referenceAudios?.length || 0) === 0;
  const usesSourceFrameAspectRatio = isH3ImageToVideo || (isH3VideoConfig && h3State.mode === 'reference_to_video' && !!config.h3MaxOptions?.startImageId) || (isSeedance25FrameToVideo && providerRoute.provider !== 'openrouter');
  const hasSeedanceFrameRoles = config.referenceImages.some(image => image.isFirstFrame || image.isLastFrame);
  const canAssignSeedanceFrames = config.referenceImages.length > 0 && config.referenceImages.length <= 2
    && currentReferenceVideos.length === 0 && currentReferenceAudios.length === 0
    && !config.referenceImages.some(image => getPersonId(image) != null);
  const updateSeedanceInput = (input: string) => {
    setGenerationError(null);
    onChange(current => ({
      ...current,
      referenceImages: input === 'frames'
        ? assignSeedanceFrames(current.referenceImages)
        : current.referenceImages.map(image => ({ ...image, isFirstFrame: false, isLastFrame: false })),
      videoAspectRatio: input === 'frames' && providerRoute.provider !== 'openrouter' ? 'adaptive' : current.videoAspectRatio,
    }));
  };
  const videoOperationOptions = (selectedVideoModel === 'seedance-2.0'
    ? [
        { label: 'Generate', value: 'generate' },
        { label: 'Ref Edit', value: 'reference_edit' },
        { label: 'Continue', value: 'continue', disabled: !currentReferenceVideos.length },
      ]
    : [
        { label: 'Generate', value: 'generate' },
        { label: 'Edit', value: 'edit' },
        { label: 'Continue', value: 'continue', disabled: !currentReferenceVideos.length },
        { label: 'Extend', value: 'extend' },
      ]).map(option => providerRoute.provider === 'openrouter' && option.value !== 'generate' ? { ...option, disabled: true } : option);
  const aspectRatioOptions = [ { label: '1:1', value: '1:1' }, { label: '3:4', value: '3:4' }, { label: '4:3', value: '4:3' }, { label: '9:16', value: '9:16' }, { label: '16:9', value: '16:9' } ];
  const resolutionOptions = [ { label: '1K', value: '1K' }, { label: '2K', value: '2K' }, { label: '4K', value: '4K' } ];
  const videoAspectRatioOptions = usesSourceFrameAspectRatio
    ? [{ label: 'Source frame', value: 'adaptive' }]
    : selectedVideoModel === 'minimax-h3'
      ? h3State.capabilities.aspectRatios.map(value => ({ label: value === 'adaptive' || value === 'auto' ? 'Source / adaptive' : value, value: value === 'auto' ? 'adaptive' : value }))
      : selectedVideoOperation === 'generate' || selectedVideoOperation === 'reference_edit'
        ? VIDEO_ASPECT_RATIO_OPTIONS.filter(o => providerRoute.provider !== 'openrouter' || o.value !== 'adaptive').map(o => ({ label: o.label, value: o.value }))
        : [{ label: 'Source', value: 'adaptive' }];
  const videoQualityOptions = selectedVideoModel === 'minimax-h3'
    ? h3State.capabilities.resolutions.map(value => ({ label: value, value: value.toLowerCase() === '2k' ? '2K' : value.toLowerCase() }))
    : VIDEO_QUALITY_OPTIONS.filter(o => o.value === '480p' || o.value === '720p' || o.value === '1080p' && !(providerRoute.provider === 'openrouter' && selectedVideoModel === 'seedance-2.5')).map(o => ({ label: o.label, value: o.value }));
  const videoDurationOptions = selectedVideoOperation === 'edit'
    ? [{ label: 'Auto (source)', value: '-1' }]
    : [
        ...(selectedVideoModel === 'seedance-2.5' && providerRoute.provider !== 'openrouter' ? [{ label: 'Auto', value: '-1' }] : []),
        ...VIDEO_DURATION_OPTIONS
          .filter(o => (selectedVideoModel === 'seedance-2.5' || o.value <= 15)
            && (selectedVideoModel !== 'minimax-h3' || o.value >= 5))
          .map(o => ({ label: o.label, value: String(o.value) })),
      ];
  const isVideoMode = config.mode === 'video';

  useEffect(() => {
    const usesH3Max = config.mode === 'video'
      && selectedVideoModel === 'minimax-h3';
    if (!usesH3Max) return;
    onChange(current => current.mode === 'video' && current.videoModel === 'minimax-h3'
      ? normalizeH3MaxDraft(current) : current);
  }, [config.mode, config.h3MaxMode, config.h3MaxOptions, config.referenceImages, config.referenceAudios?.length, config.videoAspectRatio, config.videoQuality, config.videoDuration, selectedVideoModel, onChange]);

  useEffect(() => {
    // Seedance 2.5's image-to-video endpoint derives framing from its input
    // images. Do not persist a fixed ratio the provider cannot honor. Video
    // Continue keeps fixed ratios because they control last-frame adaptation.
    if (config.mode === 'video' && providerRoute.provider !== 'openrouter' && isSeedance25FrameToVideo && config.videoAspectRatio !== 'adaptive') {
      onChange({ ...config, videoAspectRatio: 'adaptive' });
    }
  }, [config, isSeedance25FrameToVideo, providerRoute.provider, onChange]);

  const requiresSourceVideo = isVideoMode && selectedVideoModel !== 'minimax-h3' && selectedVideoOperation !== 'generate';
  const h3InputError = isH3VideoConfig ? getH3MaxInputError(config) : null;
  const isSunburst = config.imageModel === SUNBURST_MODEL;
  const routeInputError = providerRoute.error || (config.mode === 'video' && selectedVideoModel !== 'minimax-h3' && providerRoute.provider ? seedanceProviderError(providerRoute.provider, { videoModel: selectedVideoModel, mode: selectedVideoOperation === 'edit' ? 'video_edit' : selectedVideoOperation === 'extend' ? 'video_extend' : hasSeedanceFrameRoles ? 'image_to_video' : config.referenceImages.length || currentReferenceVideos.length || currentReferenceAudios.length ? 'reference_to_video' : 'text_to_video', duration: selectedVideoOperation === 'edit' ? -1 : config.videoDuration, quality: config.videoQuality, aspectRatio: config.videoAspectRatio, imageUrls: config.referenceImages.map(() => ''), videoUrls: currentReferenceVideos.map(() => ''), audioUrls: currentReferenceAudios.map(() => ''), referenceEditMode: selectedVideoOperation === 'reference_edit' }) : undefined);
  const canGenerate = !routeInputError && !isDraftLoading && (isVideoMode
    ? uploadingReferenceVideos === 0 && !hasStaleEnhancedPrompt && (isH3VideoConfig ? !h3InputError : config.prompt.trim().length > 0 && (!requiresSourceVideo || (config.referenceVideos?.length || 0) > 0))
    : !isBrainstormActive && !sunburstError && !hasStaleEnhancedPrompt && (config.prompt.trim().length > 0 || (!isSunburst && config.referenceImages.length > 0)));

  if (isMinimized) {
    return (
        <div ref={generationBarRef} className="fixed bottom-4 left-1/2 z-[120] w-[calc(100%-32px)] max-w-[480px] -translate-x-1/2 sm:bottom-5 sm:w-auto">
            <button onClick={() => setIsMinimized(false)} className="group flex h-16 w-full min-w-0 items-center justify-between gap-3 rounded-[1.4rem] border border-white/[0.1] bg-[#121821]/95 py-2 pl-2.5 pr-3.5 shadow-[0_18px_64px_rgba(0,0,0,0.58),0_0_0_1px_rgba(139,92,246,0.04)] backdrop-blur-2xl transition-all hover:-translate-y-0.5 hover:border-violet-400/25 hover:bg-[#171e29] animate-in slide-in-from-bottom-2 sm:min-w-[380px] sm:px-3">
                <div className="flex min-w-0 items-center gap-3">
                    <div className={`grid h-11 w-11 shrink-0 place-items-center rounded-2xl border ${activeRequests > 0 ? 'border-violet-400/25 bg-violet-500/15 text-violet-300' : 'border-lime-400/20 bg-lime-500/10 text-lime-300'}`}>
                      {activeRequests > 0 ? <Loader2 className="h-5 w-5 animate-spin" /> : <Sparkles className="h-5 w-5" />}
                    </div>
                    <div className="min-w-0 text-left">
                      <span className="block truncate text-sm font-semibold text-white">{activeRequests > 0 ? `${activeRequests} generation${activeRequests === 1 ? '' : 's'} running` : 'Generation bar'}</span>
                      <span className="block text-xs text-gray-500">Tap to expand controls</span>
                    </div>
                </div>
                <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white/[0.04] text-gray-500 transition-colors group-hover:bg-white/[0.07] group-hover:text-white">
                  <ChevronUp className="h-4 w-4" />
                </div>
            </button>
        </div>
    );
  }

  const modelInputError = routeInputError || h3InputError || sunburstError || (
    isH3VideoConfig ? null : isVideoMode
      ? requiresSourceVideo && !(config.referenceVideos?.length)
        ? 'Add a source video for this action.'
        : !config.prompt.trim() ? 'Enter a prompt to generate a video.' : null
      : !isBrainstormActive && !config.prompt.trim() && (isSunburst || !config.referenceImages.length)
        ? isSunburst ? 'Enter a prompt to generate an image.' : 'Enter a prompt or add a reference image.'
        : null
  );
  const modelInputHint = isH3VideoConfig ? ({
    reference_to_video: 'Click an image to choose First, Middle or Last Frame. Other images, videos and audio stay as references.',
    insert_video: 'Click a video to choose the source. Set Start and Resume in the bar below.',
    image_to_video: 'Click an image to choose First or Last Frame.',
    relight: 'Relight uses the source video and lighting-sphere image. Text prompts are not used.',
    lip_sync: 'Lip Sync uses the target image and audio clip. Text prompts are not used.',
  } as Partial<Record<typeof h3State.mode, string>>)[h3State.mode]
    : isVideoMode && selectedVideoModel === 'seedance-2.5' && selectedVideoOperation === 'generate' && config.referenceImages.length > 0
      ? hasSeedanceFrameRoles
        ? 'First / last frames use a start image and an optional end image. Use matching crops; different ratios crop the last frame to the first.'
        : 'References guide the content. For a start-to-end transition, choose First / last frames with one or two images.'
      : undefined;
  const customSizeHint = !isVideoMode && isSunburst && getOpenAIImageOptions(config.openaiImageOptions).size === 'custom'
    ? sizeAdjustment?.size === getOpenAIImageSize(config) ? sizeAdjustment.text
      : config.referenceImages.some(ref => ref.isEditSource && ref.editRegion) ? 'Only the masked area changes.' : 'Sizes auto-adjust when you finish editing.'
    : undefined;
  const hasComposerMessages = true; // Provider selection remains visible even when there are no validation messages.
  const imageCostPreview = getImageCostPreview({ ...config, imageProvider: providerRoute.provider }, config.count, imageCostHistory);
  const imageCostLabel = imageCostPreview.label;
  const brainstormImageCount = brainstormIdeaCount * config.count;
  const brainstormCostPreview = getImageCostPreview({ ...config, imageProvider: providerRoute.provider }, brainstormImageCount, imageCostHistory);
  // While jobs run the button keeps its lime surface so another generation can be
  // queued, so busy-state labels must stay dark there and only turn light on the
  // disabled gray surface.
  const busyLabelClass = canGenerate ? 'text-black' : 'text-gray-200';
  const busySpinnerClass = canGenerate ? 'text-black/60' : 'text-violet-400';
  const busyProgressFillClass = canGenerate ? 'bg-black/10' : 'bg-violet-600/20';
  const hasContentToClear = config.prompt.trim() !== ''
    || config.referenceImages.length > 0
    || (config.referenceVideos?.length || 0) > 0
    || (config.referenceAudios?.length || 0) > 0;
  const personGroups = getPersonGroups(config.referenceImages, config.personGroups);
  const brainstormInputImages = config.imageModel === SUNBURST_MODEL ? getSunburstReferences(config.referenceImages) : config.referenceImages;
  const isKeyframeMode = isVideoMode && (
    isH3VideoConfig ? h3UsesImageFrames && config.referenceImages.length > 0
    : config.referenceImages.some(img => img.isFirstFrame || img.isLastFrame)
  );

  const referenceVideoDuration = (config.referenceVideos || []).reduce(
    (total, video) => total + (video.duration != null && video.duration > 0 ? video.duration : 0),
    0
  );
  const primaryVideoDuration = config.referenceVideos?.[0]?.duration != null && config.referenceVideos[0].duration! > 0
    ? config.referenceVideos[0].duration!
    : 0;
  const videoCost = isVideoMode
    ? selectedVideoModel === 'minimax-h3' ? estimateH3MaxCost(config) : providerRoute.provider !== 'evolink' ? null : estimateVideoCost(
        selectedVideoModel,
        config.videoQuality,
        selectedVideoOperation === 'edit' ? -1 : config.videoDuration,
        (config.referenceVideos?.length || 0) > 0,
        referenceVideoDuration,
        selectedVideoOperation,
        primaryVideoDuration,
        0,
        undefined,
      )
    : null;
  const videoActionLabel = isH3VideoConfig
    ? h3State.mode === 'lip_sync' ? 'Lip Sync' : h3State.mode === 'recast' ? 'Recast' : h3State.mode === 'relight' ? 'Relight' : h3State.mode === 'extend_video' ? 'Extend' : h3State.mode === 'insert_video' ? 'Insert' : 'Generate'
    : selectedVideoOperation === 'edit'
    ? 'Edit'
    : selectedVideoOperation === 'reference_edit'
      ? 'Ref Edit'
      : selectedVideoOperation === 'extend'
        ? 'Extend'
        : getVideoPromptIntent(config) === 'continue' ? 'Continue' : 'Generate';

  return (
    <div 
        ref={generationBarRef}
        className="fixed bottom-0 left-1/2 z-[120] w-full max-w-[1400px] -translate-x-1/2 px-0 sm:bottom-4 sm:px-4"
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onPaste={handlePaste}
    >
      {!isVideoMode && editAreaSourceId && config.referenceImages.find(ref => ref.id === editAreaSourceId) && <ImageEditArea
        source={config.referenceImages.find(ref => ref.id === editAreaSourceId)!}
        onClose={() => setEditAreaSourceId(null)}
        onSave={(region, canvas) => {
          const ratios = ['1:1', '3:4', '4:3', '9:16', '16:9'] as const;
          const aspectRatio = [...ratios].sort((a, b) => {
            const ratio = (value: string) => Number(value.split(':')[0]) / Number(value.split(':')[1]);
            return Math.abs(ratio(a) - canvas.width / canvas.height) - Math.abs(ratio(b) - canvas.width / canvas.height);
          })[0];
          const next = { ...config, aspectRatio, referenceImages: config.referenceImages.map(ref => ({ ...ref,
            isEditSource: ref.id === editAreaSourceId, editRegion: ref.id === editAreaSourceId ? region : undefined })),
            openaiImageOptions: { ...getOpenAIImageOptions(config.openaiImageOptions), size: 'custom' as const, width: canvas.width, height: canvas.height } };
          if (config.enhancedForImageContextKey && !isEnhancedPromptStale(config)) {
            try {
              const previousEdit = getSunburstEditIntent(config.prompt, config.referenceImages, config);
              if (previousEdit?.sourceIndex != null && config.referenceImages[previousEdit.sourceIndex].id === editAreaSourceId) {
                next.enhancedForImageContextKey = getImagePromptContextKey(next);
              }
            } catch { /* Preserve stale checks when a different source is chosen. */ }
          }
          onChange(next);
          setEditAreaSourceId(null);
          setGenerationError(null);
        }}
      />}
      <div className={`${PROMPT_PANEL_CLASS} rounded-t-[1.6rem] rounded-b-none border border-x-0 border-b-0 pb-[max(0.625rem,env(safe-area-inset-bottom))] animate-in slide-in-from-bottom duration-300 sm:rounded-[1.6rem] sm:border ${
          (isDragging || isDraggingSavedRef) ? 'border-violet-400/70 bg-violet-950/80' : 'border-white/[0.09]'
      }`}>
        
        {/* Overlay for Drop Indication */}
        {(isDragging || isDraggingSavedRef) && (
            <div className="pointer-events-none absolute inset-0 z-50 flex items-center justify-center rounded-[1.6rem] border-2 border-dashed border-violet-400 bg-black/70 backdrop-blur-sm">
                <div className="flex flex-col items-center gap-3 text-white animate-bounce">
                    <ImagePlus className="w-10 h-10 text-violet-400" />
                    <span className="text-lg font-bold">
                        {isDraggingSavedRef ? 'Drop to Add Saved Reference' : 'Drop Image to Add Reference'}
                    </span>
                </div>
            </div>
        )}

        {/* Minimize Tab */}
        <div className="absolute left-1/2 top-px flex -translate-x-1/2 -translate-y-full items-end gap-1">
            <button 
                onClick={() => setIsMinimized(true)}
                className="group flex h-7 items-center gap-1.5 rounded-t-xl border border-b-0 border-white/[0.09] bg-[#121821]/95 px-3 text-gray-500 shadow-[0_-8px_22px_rgba(0,0,0,0.2)] backdrop-blur-xl transition-colors hover:text-white"
                aria-label="Minimize generation bar"
            >
                <span className="text-[9px] font-bold uppercase tracking-[0.14em] transition-colors group-hover:text-violet-300">Hide</span>
                <ChevronDown className="h-3 w-3" />
            </button>
        </div>

        {/* CLEAR BUTTON */}
        {hasContentToClear && (
           <button 
                onClick={handleClearAll}
                className="absolute right-3 top-3 z-20 grid h-8 w-8 place-items-center rounded-lg border border-transparent text-gray-600 transition-all hover:border-red-400/15 hover:bg-red-500/[0.08] hover:text-red-300"
                title="Clear Prompt & Images"
            >
                <Eraser className="w-4 h-4" />
           </button>
       )}

        {/* INPUT AREA */}
        <div className="flex flex-col gap-3 relative">
            {/* UPLOAD ZONES */}
            <div className="flex min-h-[50px] items-start gap-2 overflow-x-auto pr-10 no-scrollbar sm:gap-2.5">
                {/* Reference Gallery Button */}
                <div className="relative shrink-0" ref={refGalleryRef}>
                    <button 
                        onClick={() => setIsRefGalleryOpen(!isRefGalleryOpen)}
                        onDragOver={handleGalleryDragOver}
                        onDragLeave={handleGalleryDragLeave}
                        onDrop={handleGalleryDrop}
                        className={`w-12 h-12 rounded-lg border transition-all flex flex-col items-center justify-center gap-0.5 shrink-0 ${
                            isDraggingToGallery 
                                ? 'border-green-500 bg-green-500/20 border-solid scale-105' 
                                : isRefGalleryOpen 
                                    ? 'border-violet-500 bg-violet-500/20' 
                                    : 'border-dashed border-gray-700 bg-gray-800/30 hover:bg-gray-800 hover:border-gray-500'
                        } text-gray-400 hover:text-white`}
                        title={isDraggingToGallery ? "Drop to save" : "Reference Gallery"}
                    >
                        <FolderOpen className={`w-4 h-4 ${isDraggingToGallery ? 'text-green-400' : ''}`} />
                        <span className={`text-[8px] font-bold uppercase ${isDraggingToGallery ? 'text-green-400' : ''}`}>
                            {refGallery.length > 0 ? refGallery.length : ''}
                        </span>
                    </button>

                    {/* Reference Gallery Dropdown - rendered via portal */}
                    {isRefGalleryOpen && createPortal(
                        <div 
                            ref={galleryDropdownRef}
                            className="fixed w-[336px] max-w-[calc(100vw-16px)] bg-[#1c2128] border border-gray-700 rounded-xl shadow-2xl z-[200] overflow-y-auto animate-in fade-in slide-in-from-bottom-2 duration-200"
                            style={{
                                bottom: `${refGalleryPos.bottom}px`,
                                left: `${refGalleryPos.left}px`,
                                maxHeight: `calc(100dvh - ${refGalleryPos.bottom + 8}px)`
                            }}
                        >
                            <div className="p-3 border-b border-gray-700 flex items-center justify-between">
                                <span className="text-sm font-semibold text-white">Saved References</span>
                                <button type="button" aria-label="Close saved references" onClick={() => setIsRefGalleryOpen(false)} className="rounded-md p-1 text-gray-500 hover:bg-white/5 hover:text-white"><X className="h-3.5 w-3.5" /></button>
                            </div>
                            <div className="flex gap-1 border-b border-white/10 p-2" role="tablist" aria-label="Saved reference types">
                              <button type="button" role="tab" aria-selected={refGalleryTab === 'images'} onClick={() => setRefGalleryTab('images')} className={`flex min-h-8 flex-1 items-center justify-center gap-1.5 rounded-lg text-xs ${refGalleryTab === 'images' ? 'bg-violet-500/15 text-violet-300' : 'text-gray-400 hover:bg-white/5'}`}><ImageIcon className="h-3.5 w-3.5" />Images <span className="text-[10px] opacity-60">{refGallery.length}</span></button>
                              <button type="button" role="tab" aria-selected={refGalleryTab === 'people'} onClick={() => setRefGalleryTab('people')} className={`flex min-h-8 flex-1 items-center justify-center gap-1.5 rounded-lg text-xs ${refGalleryTab === 'people' ? 'bg-violet-500/15 text-violet-300' : 'text-gray-400 hover:bg-white/5'}`}><Users className="h-3.5 w-3.5" />People</button>
                            </div>
                            {refGalleryError && <p role="alert" className="px-3 pt-2 text-[11px] text-red-400">{refGalleryError}</p>}
                            {refGalleryTab === 'people' ? <SavedPeople references={config.referenceImages} gallery={refGallery} draft={config}
                              addDisabled={isH3VideoConfig && h3State.mode !== 'reference_to_video' ? 'Choose Reference to Video Max to add a saved person, or attach individual photos for this action.' : !isH3VideoConfig && config.referenceImages.some(image => image.isFirstFrame || image.isLastFrame) ? 'Remove frame roles before adding people.' : undefined}
                              onAdd={person => onChange(addSavedPersonToDraft(config, person, maxReferenceImages))}
                              onSaved={() => {}} /> : <SavedReferenceImages images={refGallery} onAdd={handleAddFromGallery}
                              onSaved={image => setRefGallery(current => current.map(item => item.id === image.id ? image : item))}
                              onRemove={handleDeleteFromGallery} onDragStart={handleGalleryItemDragStart} onDragEnd={handleGalleryItemDragEnd} />}

                        </div>,
                        document.body
                    )}
                </div>

                <input ref={refInputRef} type="file" className="hidden" accept="image/*" multiple onChange={handleRefImageUpload} />
                <button onClick={() => refInputRef.current?.click()} aria-label="Add reference images" disabled={maxReferenceImages === 0} title={maxReferenceImages === 0 ? 'This action does not accept image inputs' : `Add images (max ${maxReferenceImages})`} className="w-12 h-12 rounded-lg border border-dashed border-gray-700 bg-gray-800/30 hover:bg-gray-800 hover:border-gray-500 text-gray-400 hover:text-white disabled:cursor-not-allowed disabled:opacity-30 flex flex-col items-center justify-center gap-0.5 transition-all shrink-0">
                    <ImagePlus className="w-4 h-4" />
                    <span className="text-[8px] font-bold uppercase">Ref</span>
                </button>

                {isVideoMode && maxReferenceVideos > 0 && (<>
                  <input ref={videoInputRef} type="file" className="hidden" accept={isH3VideoConfig ? 'video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm' : 'video/*,.mp4,.mov'} multiple onChange={handleVideoFileUpload} />
                  <button onClick={() => videoInputRef.current?.click()} aria-label="Add video input" className="w-12 h-12 rounded-lg border border-dashed border-purple-700 bg-purple-900/10 hover:bg-purple-900/30 hover:border-purple-500 text-purple-400 hover:text-purple-200 flex flex-col items-center justify-center gap-0.5 transition-all shrink-0" title={`Add video (max ${maxReferenceVideos}, ${isH3VideoConfig && h3State.mode === 'extend_video' ? 50 : MAX_VIDEO_UPLOAD_MB} MB each)`}>
                    <Film className="w-4 h-4" />
                    <span className="text-[8px] font-bold uppercase">Vid</span>
                  </button>
                </>)}
                {isVideoMode && maxReferenceAudios > 0 && (<>
                  <input ref={audioInputRef} type="file" className="hidden" accept="audio/*,.mp3,.wav,.m4a,.aac,.ogg,.flac,.aif,.aiff" multiple onChange={handleAudioFileUpload} />
                  <button onClick={() => audioInputRef.current?.click()} aria-label="Add audio input" className="w-12 h-12 rounded-lg border border-dashed border-green-700 bg-green-900/10 hover:bg-green-900/30 hover:border-green-500 text-green-400 hover:text-green-200 flex flex-col items-center justify-center gap-0.5 transition-all shrink-0" title={`Add audio (max ${maxReferenceAudios})`}>
                    <Music className="w-4 h-4" />
                    <span className="text-[8px] font-bold uppercase">Aud</span>
                  </button>
                </>)}

                {/* YouTube Channel Ref - hidden in video mode */}
                {!isVideoMode && (
                <YouTubeChannelRef
                  onAddReferences={(images) => {
                    // Downloads may finish after the user changes resolution or model.
                    onChange(current => {
                      const limit = current.mode === 'video' && current.videoModel === 'minimax-h3' ? getH3MaxUIState(current).imageLimit
                        : current.mode === 'video' && current.videoModel === 'seedance-2.0' ? 9 : current.imageModel === SUNBURST_MODEL ? 16 : 14;
                      const refs = current.referenceImages || [];
                      return { ...current, referenceImages: [...refs, ...images.slice(0, Math.max(0, limit - refs.length))] };
                    });
                  }}
                  onPrepareBrainstorm={handleYouTubeBrainstorm}
                  referenceImages={config.referenceImages}
                  personGroups={config.personGroups}
                  draftKey={getYouTubeDraftKey(config)}
                  remainingSlots={maxReferenceImages - (config.referenceImages?.length || 0)}
                />
                )}

                {config.referenceImages.map((img, index) => (
                    <div
                        key={img.id}
                        draggable
                        onDragStart={(e) => { handleDragStart(e, img, index); closeRefPopover(); }}
                        onDragEnd={handleDragEnd}
                        onClick={(e) => openRefPopover('image', img.id, e)}
                        className={`relative w-12 h-12 rounded-lg bg-gray-800 overflow-hidden group shrink-0 shadow-lg border-2 transition-colors cursor-pointer active:cursor-grabbing ${
                            isVideoMode
                              ? (isH3VideoConfig
                                  ? getH3MaxImageLabel(config, img.id) === 'START' ? 'border-amber-500' : getH3MaxImageLabel(config, img.id) === 'END' ? 'border-cyan-500' : getH3MaxImageLabel(config, img.id) === 'MIDDLE' ? 'border-lime-500' : 'border-gray-700'
                                  : img.isFirstFrame ? 'border-amber-500' : img.isLastFrame ? 'border-cyan-500' : getPersonId(img) ? 'border-current' : 'border-gray-700')
                              : (getPersonId(img) ? 'border-current' : 'border-gray-700')
                        } ${draggedRefId === img.id ? 'opacity-50 scale-95' : ''} ${activeRefPopover?.kind === 'image' && activeRefPopover.id === img.id ? 'ring-2 ring-violet-500' : ''}`}
                        style={!isH3VideoConfig && getPersonId(img) ? { borderColor: personColor(getPersonId(img)!) } : undefined}
                        title={isH3VideoConfig
                          ? `${getH3MaxImageLabel(config, img.id)} — click for actions`
                          : `${img.isFirstFrame ? 'First frame' : img.isLastFrame ? 'Last frame' : 'Reference'} ${index + 1} — click for actions; drag to insert ${getPersonId(img) ? getPersonTag(getPersonId(img)!) : `@REF_IMAGE_${index + 1}`}`}
                    >
                        <img src={img.data} className="w-full h-full object-cover pointer-events-none" />

                        {/* Drag indicator */}
                        <div className="absolute bottom-0.5 right-0.5 opacity-0 group-hover:opacity-50 pointer-events-none">
                            <GripVertical className="w-2.5 h-2.5 text-white" />
                        </div>

                        {isVideoMode && (isH3VideoConfig ? h3UsesImageFrames && getH3MaxImageLabel(config, img.id) === 'START' : img.isFirstFrame) && (
                          <div className="absolute top-0 left-0 bg-amber-500 text-black px-0.5 py-0.5 rounded-br pointer-events-none"><Rewind className="w-2 h-2" /></div>
                        )}
                        {isVideoMode && (isH3VideoConfig ? h3UsesImageFrames && getH3MaxImageLabel(config, img.id) === 'END' : img.isLastFrame) && (
                          <div className="absolute top-0 left-0 bg-cyan-500 text-black px-0.5 py-0.5 rounded-br pointer-events-none"><FastForward className="w-2 h-2" /></div>
                        )}
                        {isVideoMode && !isH3VideoConfig && (img.isFirstFrame || img.isLastFrame) && (
                          <span className={`pointer-events-none absolute bottom-0 left-0 rounded-tr px-1 text-[8px] font-bold text-black ${img.isFirstFrame ? 'bg-amber-500' : 'bg-cyan-500'}`}>{img.isFirstFrame ? 'FIRST' : 'LAST'}</span>
                        )}
                        {isH3VideoConfig && <span className="pointer-events-none absolute bottom-0 left-0 rounded-tr bg-violet-500 px-1 text-[8px] font-bold text-white">{getH3MaxImageLabel(config, img.id)}</span>}
                        {!isH3VideoConfig && getPersonId(img) && (
                          <div className="absolute top-0 left-0 max-w-full truncate rounded-br px-1 py-0.5 text-[7px] font-bold text-black pointer-events-none" style={{ backgroundColor: personColor(getPersonId(img)!) }}>
                            {personGroups.find(group => group.id === getPersonId(img))?.label}
                          </div>
                        )}
                        {!isVideoMode && img.isVideoContext && !getPersonId(img) && <div className="pointer-events-none absolute left-0 top-0 rounded-br bg-red-600 px-1 py-0.5 text-[7px] font-bold text-white">YT</div>}
                        {!isVideoMode && img.editRegion && <div className="pointer-events-none absolute right-0 top-0 rounded-bl bg-emerald-500 px-1 py-0.5 text-[7px] font-bold text-black">MASK</div>}
                    </div>
                ))}

                {/* Video Reference Thumbnails */}
                {isVideoMode && config.referenceVideos && config.referenceVideos.map((vid, index) => (
                    <div
                        key={vid.id}
                        onClick={(e) => openRefPopover('video', vid.id, e)}
                        className={`relative w-12 h-12 rounded-lg bg-gray-800 overflow-hidden group shrink-0 shadow-lg border-2 transition-colors cursor-pointer ${
                          vid.isContinuation ? 'border-lime-500' : 'border-purple-500'
                        } ${activeRefPopover?.kind === 'video' && activeRefPopover.id === vid.id ? 'ring-2 ring-violet-500' : ''}`}
                        title={isH3VideoConfig ? `${h3State.mode !== 'reference_to_video' && index === 0 ? 'Source video' : `Video ${h3State.mode === 'insert_video' ? index : index + 1}`} — click for actions` : vid.isContinuation ? 'Continue from this video — click for actions' : 'Reference video — click for actions'}
                    >
                        <video src={vid.url} muted preload="metadata" className="w-full h-full object-cover pointer-events-none"
                          onLoadedData={(e) => { (e.target as HTMLVideoElement).currentTime = 0.1; }}
                        />
                        {isH3VideoConfig ? <div className="absolute top-0 left-0 rounded-br bg-purple-500 px-1 py-0.5 text-[7px] font-bold text-white">{h3State.mode !== 'reference_to_video' && index === 0 ? 'SOURCE' : `Video ${h3State.mode === 'insert_video' ? index : index + 1}`}</div> : vid.isContinuation ? (
                          <div className="absolute top-0 left-0 bg-lime-500 text-black px-0.5 py-0.5 rounded-br pointer-events-none"><SkipForward className="w-2 h-2" /></div>
                        ) : (
                          <div className="absolute top-0 left-0 bg-purple-500 text-white px-1 py-0.5 text-[6px] font-bold uppercase rounded-br pointer-events-none">Vid</div>
                        )}
                    </div>
                ))}

                {/* Audio Reference Thumbnails */}
                {isVideoMode && config.referenceAudios && config.referenceAudios.map((aud, index) => (
                    <div
                        key={aud.id}
                        onClick={(e) => openRefPopover('audio', aud.id, e)}
                        className={`relative w-12 h-12 rounded-lg bg-green-900/20 overflow-hidden group shrink-0 shadow-lg border-2 border-green-500 flex items-center justify-center cursor-pointer ${activeRefPopover?.kind === 'audio' && activeRefPopover.id === aud.id ? 'ring-2 ring-violet-500' : ''}`}
                        title={`${isH3VideoConfig && (h3State.mode === 'lip_sync' || h3State.mode === 'text_to_video' || h3State.mode === 'image_to_video') ? 'Target soundtrack' : aud.name || `Audio ${index + 1}`} — click for actions`}
                    >
                        <Music className="w-5 h-5 text-green-400" />
                        <div className="absolute top-0 left-0 bg-green-500 text-black px-1 py-0.5 text-[6px] font-bold uppercase rounded-br pointer-events-none">
                          {isH3VideoConfig ? h3State.mode === 'lip_sync' || h3State.mode === 'text_to_video' || h3State.mode === 'image_to_video' ? 'TARGET' : `Audio ${index + 1}` : 'Aud'}
                        </div>
                    </div>
                ))}
            </div>

            {/* Reference Tile Action Popover */}
            {activeRefPopover && (() => {
              if (activeRefPopover.kind === 'image') {
                const img = config.referenceImages.find(i => i.id === activeRefPopover.id);
                if (!img) return null;
                // Keep the shared reference menu; H3 roles preserve person identities.
                const anyPersonTag = config.referenceImages.some(r => getPersonId(r) != null);
                const person = personGroups.find(group => group.id === getPersonId(img));
                const items: RefActionItem[] = [];
                if (!isVideoMode && !getPersonId(img) && !img.isVideoContext) {
                  items.push({ id: 'editArea', icon: Scan, label: img.editRegion ? 'Change edit area' : 'Edit area', tone: 'lime', active: !!img.editRegion,
                    onClick: () => { setEditAreaSourceId(img.id); closeRefPopover(); } });
                }
                if (isVideoMode && !isH3VideoConfig && selectedVideoOperation === 'generate') {
                  items.push({
                    id: 'firstFrame',
                    icon: Rewind,
                    label: 'First Frame',
                    tone: 'amber',
                    active: !!img.isFirstFrame,
                    disabled: anyPersonTag && !img.isFirstFrame,
                    onClick: () => handleToggleFirstFrame(img.id),
                  });
                  items.push({
                    id: 'lastFrame',
                    icon: FastForward,
                    label: 'Last Frame',
                    tone: 'cyan',
                    active: !!img.isLastFrame,
                    disabled: anyPersonTag && !img.isLastFrame,
                    onClick: () => handleToggleLastFrame(img.id),
                  });
                }
                if (isH3VideoConfig && (h3State.mode === 'image_to_video' || h3State.mode === 'reference_to_video')) {
                  const frameLabel = getH3MaxImageLabel(config, img.id);
                  const frameItem = (role: 'start' | 'middle' | 'end', label: string, icon: React.ElementType, tone: RefActionItem['tone']) => ({
                    id: `h3-${role}-frame`, icon, label, tone, active: frameLabel === role.toUpperCase(),
                    disabled: role === 'middle' && config.videoQuality === '1080p' && frameLabel !== 'MIDDLE',
                    onClick: () => handleH3ImageRole(img.id, h3State.mode === 'reference_to_video' && frameLabel === role.toUpperCase() ? 'reference' : role),
                  });
                  items.push(frameItem('start', 'First Frame', Rewind, 'amber'));
                  if (h3State.mode === 'reference_to_video') items.push(frameItem('middle', config.videoQuality === '1080p' ? 'Middle Frame · 480p / 768p' : 'Middle Frame', Clock, 'lime'));
                  items.push(frameItem('end', 'Last Frame', FastForward, 'cyan'));
                  if (h3State.mode === 'reference_to_video') items.push({ id: 'h3-reference', icon: ImageIcon, label: 'Use as reference', tone: 'gray', active: !['START', 'MIDDLE', 'END'].includes(frameLabel), onClick: () => handleH3ImageRole(img.id, 'reference') });
                }
                items.push({
                  id: 'remove',
                  icon: X,
                  label: person ? `Remove ${person.label} (${person.images.length} ${person.images.length === 1 ? 'photo' : 'photos'})` : 'Remove reference',
                  tone: 'red',
                  onClick: () => { handleRemoveImage(img.id); closeRefPopover(); },
                });
                return (
                  <RefActionPopover
                    anchorRect={activeRefPopover.rect}
                    items={items}
                    compactActions
                    onClose={closeRefPopover}
                  />
                );
              }
              if (activeRefPopover.kind === 'video') {
                const vid = (config.referenceVideos || []).find(v => v.id === activeRefPopover.id);
                if (!vid) return null;
                const items: RefActionItem[] = [
                  ...(!isH3VideoConfig ? [{
                    id: 'continue',
                    icon: SkipForward,
                    label: 'Continue',
                    tone: 'lime' as const,
                    active: !!vid.isContinuation,
                    onClick: () => {
                      const newVids = config.referenceVideos.map(v =>
                        ({ ...v, isContinuation: v.id === vid.id && !vid.isContinuation })
                      );
                      onChange({ ...config, videoOperation: 'generate', referenceVideos: newVids });
                      closeRefPopover();
                    },
                  }] : ['insert_video', 'extend_video', 'recast', 'relight'].includes(h3State.mode) ? [{
                    id: 'source', icon: Film, label: 'Use as source video', tone: 'cyan' as const,
                    active: config.referenceVideos[0]?.id === vid.id,
                    onClick: () => { onChange({ ...config, referenceVideos: [vid, ...config.referenceVideos.filter(video => video.id !== vid.id)] }); closeRefPopover(); },
                  }] : []),
                  {
                    id: 'remove',
                    icon: X,
                    label: 'Remove',
                    tone: 'red',
                    onClick: () => {
                      onChange({ ...config, referenceVideos: config.referenceVideos.filter(v => v.id !== vid.id) });
                      closeRefPopover();
                    },
                  },
                ];
                return (
                  <RefActionPopover
                    anchorRect={activeRefPopover.rect}
                    items={items}
                    onClose={closeRefPopover}
                  />
                );
              }
              if (activeRefPopover.kind === 'audio') {
                const aud = (config.referenceAudios || []).find(a => a.id === activeRefPopover.id);
                if (!aud) return null;
                const items: RefActionItem[] = [
                  {
                    id: 'remove',
                    icon: X,
                    label: 'Remove',
                    tone: 'red',
                    onClick: () => {
                      onChange({ ...config, referenceAudios: config.referenceAudios.filter(a => a.id !== aud.id) });
                      closeRefPopover();
                    },
                  },
                ];
                return (
                  <RefActionPopover
                    anchorRect={activeRefPopover.rect}
                    items={items}
                    onClose={closeRefPopover}
                  />
                );
              }
              return null;
            })()}

            {/* PROMPT INPUT */}
            <div className={PROMPT_INPUT_CLASS}>
                <button
                    type="button"
                    className={`${promptResizeClass(isResizingPrompt)} disabled:cursor-not-allowed disabled:opacity-40`}
                    disabled={!h3PromptSupported}
                    onPointerDown={handlePromptResizeStart}
                    onPointerMove={handlePromptResizeMove}
                    onPointerUp={handlePromptResizeEnd}
                    onPointerCancel={handlePromptResizeEnd}
                    onLostPointerCapture={handlePromptResizeEnd}
                    onKeyDown={handlePromptResizeKeyDown}
                    aria-label="Resize prompt field"
                    aria-valuemin={MIN_PROMPT_HEIGHT}
                    aria-valuemax={MAX_PROMPT_HEIGHT}
                    aria-valuenow={Math.round(promptHeight)}
                    title={promptDisabledMessage || 'Drag up or down to resize the prompt'}
                >
                    <span className="h-1 w-12 rounded-full bg-current shadow-sm transition-colors" />
                </button>
                <textarea
                    ref={textareaRef}
                    aria-label="Generation prompt"
                    disabled={!h3PromptSupported}
                    title={promptDisabledMessage}
                    value={displayPrompt(config.prompt)}
                    onChange={handleTextareaChange}
                    onKeyDown={handleTextareaKeyDown}
                    onBlur={() => {
                        // Delay to allow clicks on dropdown to process
                        setTimeout(() => setMentionState(prev => ({ ...prev, active: false })), 200);
                    }}
                    placeholder={!h3PromptSupported ? promptDisabledMessage : isVideoMode
                      ? selectedVideoOperation === 'reference_edit'
                        ? "Describe the requested change while preserving the people, setting, motion, and visual continuity from @VIDEO_1..."
                        : selectedVideoOperation === 'edit'
                        ? "Describe what to remove, replace, or restyle in the source video..."
                        : selectedVideoOperation === 'extend'
                          ? "Describe how the source video should continue forward or backward..."
                          : isKeyframeMode
                            ? "Describe the video... Start/end frames active; mention them naturally"
                            : "Describe the video you want to generate... Use @ to reference an image"
                      : "Describe the image you want to generate... Use @ to reference an image"}
                    className={`${PROMPT_TEXTAREA_CLASS} disabled:cursor-not-allowed disabled:text-gray-500 disabled:opacity-60`}
                    style={{ height: `${promptHeight}px`, minHeight: `${MIN_PROMPT_HEIGHT}px`, maxHeight: 'min(600px, calc(100dvh - 17.5rem))', outline: 'none', boxShadow: 'none' }}
                    spellCheck={false}
                />
                
                {/* Mention Dropdown */}
                {h3PromptSupported && mentionState.active && !isKeyframeMode && (config.referenceImages.length > 0 || (isVideoMode && ((config.referenceVideos?.length || 0) > 0 || (config.referenceAudios?.length || 0) > 0))) && mentionState.position && (() => {
                    const groupItems = findPersonMentions(config.referenceImages, mentionState.query);
                    const filteredRefs = config.referenceImages
                        .map((img, index) => ({ img, index }))
                        .filter(({ index }) => `REF_IMAGE_${index + 1}`.toLowerCase().includes(mentionState.query.toLowerCase()));

                    const filteredVideos = (config.referenceVideos || [])
                        .map((vid, index) => ({ vid, index }))
                        .filter(({ index }) => `VIDEO_${index + 1}`.toLowerCase().includes(mentionState.query.toLowerCase()));

                    const filteredAudios = (config.referenceAudios || [])
                        .map((aud, index) => ({ aud, index }))
                        .filter(({ index }) => `AUDIO_${index + 1}`.toLowerCase().includes(mentionState.query.toLowerCase()));

                    const totalItems = groupItems.length + filteredRefs.length + filteredVideos.length + filteredAudios.length;

                    return (
                    <div
                        className="absolute z-[200] bg-[#1c2128] border border-gray-700 rounded-xl shadow-2xl overflow-hidden animate-in fade-in slide-in-from-bottom-2 duration-200 w-72 max-h-64 overflow-y-auto custom-scrollbar"
                        style={{
                            bottom: `calc(100% - ${mentionState.position.top}px + 8px)`,
                            left: `${mentionState.position.left}px`
                        }}
                    >
                        {/* Group mentions */}
                        {groupItems.map((group, gi) => (
                            <button
                                key={group.tag}
                                onMouseDown={(e) => {
                                    e.preventDefault();
                                    insertGroupMention(group.tag);
                                }}
                                className={`w-full flex items-center gap-3 p-2 text-left transition-colors ${
                                    gi === mentionIndex ? 'bg-violet-600/20 text-white' : 'text-gray-300 hover:bg-gray-800'
                                }`}
                            >
                                <div className="flex -space-x-1.5 shrink-0">
                                    {group.images.slice(0, 3).map(img => (
                                        <img key={img.id} src={img.data} className="w-6 h-6 rounded-full object-cover border border-gray-800" />
                                    ))}
                                </div>
                                <span className={`text-sm font-semibold truncate ${'text-gray-100'}`}>
                                    {group.label} <span className="text-[10px] font-normal text-gray-400">{group.images.length} {group.images.length === 1 ? 'photo' : 'photos'} · {group.tag}</span>
                                </span>
                            </button>
                        ))}
                        {groupItems.length > 0 && (filteredRefs.length > 0 || filteredVideos.length > 0 || filteredAudios.length > 0) && (
                            <div className="border-t border-gray-800 my-0.5" />
                        )}
                        {/* Individual image refs */}
                        {filteredRefs.map(({ img, index }, i) => (
                                <button
                                    key={img.id}
                                    onMouseDown={(e) => {
                                        e.preventDefault();
                                        insertMention(img, index);
                                    }}
                                    className={`w-full flex items-center gap-3 p-2 text-left transition-colors ${
                                        (i + groupItems.length) === mentionIndex ? 'bg-violet-600/20 text-white' : 'text-gray-300 hover:bg-gray-800'
                                    }`}
                                >
                                    <img src={img.data} className="w-8 h-8 rounded object-cover shrink-0" />
                                    <span className="text-sm font-medium truncate">REF_IMAGE_{index + 1}</span>
                                </button>
                            ))
                        }
                        {/* Video refs */}
                        {filteredVideos.length > 0 && filteredRefs.length > 0 && (
                            <div className="border-t border-gray-800 my-0.5" />
                        )}
                        {filteredVideos.map(({ vid, index }, i) => (
                            <button
                                key={vid.id}
                                onMouseDown={(e) => {
                                    e.preventDefault();
                                    insertGroupMention(`@VIDEO_${index + 1}`);
                                }}
                                className={`w-full flex items-center gap-3 p-2 text-left transition-colors ${
                                    (i + groupItems.length + filteredRefs.length) === mentionIndex ? 'bg-violet-600/20 text-white' : 'text-gray-300 hover:bg-gray-800'
                                }`}
                            >
                                <div className="w-8 h-8 rounded bg-purple-900/40 flex items-center justify-center shrink-0">
                                    <Video className="w-4 h-4 text-purple-400" />
                                </div>
                                <span className="text-sm font-medium truncate text-purple-400">VIDEO_{index + 1}</span>
                            </button>
                        ))}
                        {/* Audio refs */}
                        {filteredAudios.length > 0 && (filteredRefs.length > 0 || filteredVideos.length > 0) && (
                            <div className="border-t border-gray-800 my-0.5" />
                        )}
                        {filteredAudios.map(({ aud, index }, i) => (
                            <button
                                key={aud.id}
                                onMouseDown={(e) => {
                                    e.preventDefault();
                                    insertGroupMention(`@AUDIO_${index + 1}`);
                                }}
                                className={`w-full flex items-center gap-3 p-2 text-left transition-colors ${
                                    (i + groupItems.length + filteredRefs.length + filteredVideos.length) === mentionIndex ? 'bg-violet-600/20 text-white' : 'text-gray-300 hover:bg-gray-800'
                                }`}
                            >
                                <div className="w-8 h-8 rounded bg-green-900/40 flex items-center justify-center shrink-0">
                                    <Music className="w-4 h-4 text-green-400" />
                                </div>
                                <span className="text-sm font-medium truncate text-green-400">AUDIO_{index + 1}{aud.name ? ` (${aud.name})` : ''}</span>
                            </button>
                        ))}
                        {totalItems === 0 && (
                            <div className="p-3 text-center text-xs text-gray-500">No matching references</div>
                        )}
                    </div>
                    );
                })()}
            </div>
        </div>

        {hasComposerMessages && <div role="region" aria-label="Generation messages" data-testid="generation-messages" className="space-y-2 px-1">
          <ProviderRouteControl model={config.mode === 'video' ? selectedVideoModel : config.imageModel} compact showError={false} />
          {modelInputError && <p role={sunburstError ? 'alert' : 'status'} className="px-1 text-xs leading-5 text-amber-300">{modelInputError}</p>}
          {generationError && generationError !== modelInputError && <p role="alert" className="px-1 text-xs leading-5 text-red-400">{generationError}</p>}
          {attachmentError && <div role="alert" className="flex items-start justify-between gap-3 px-1 text-xs leading-5 text-red-400"><span className="whitespace-pre-line">{attachmentError}</span><button type="button" aria-label="Dismiss attachment message" onClick={() => setAttachmentError(null)} className="shrink-0 rounded p-1 text-gray-400 hover:text-white"><X className="h-3.5 w-3.5" /></button></div>}
        {hasStaleEnhancedPrompt && (
          <div className="flex flex-col gap-3 rounded-xl border border-amber-500/30 bg-amber-500/[0.08] px-3.5 py-3 sm:flex-row sm:items-center sm:justify-between" role="alert">
            <div className="flex min-w-0 items-start gap-2.5">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
              <div className="min-w-0">
                <p className="text-xs font-semibold text-amber-100">Seçimler değişti — yeniden Enhance gerekli</p>
                <p className="mt-1 text-[11px] leading-5 text-amber-100/65">
                  {enhancedPromptTargetLabel !== currentPromptTargetLabel && <><span className="font-medium text-amber-200/80">{enhancedPromptTargetLabel}</span><span className="mx-1.5 text-amber-400/50">→</span></>}
                  <span className="font-medium text-white">{currentPromptTargetLabel}</span>
                  . Mevcut prompt önceki seçimler için hazırlandı. Revert ile kendi promptuna dön, ardından yeniden Enhance yap.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={handleRevertEnhancedPrompt}
              className="flex h-9 shrink-0 items-center justify-center gap-2 rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 text-xs font-semibold text-amber-200 transition-colors hover:border-amber-300/50 hover:bg-amber-400/15 hover:text-white"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Revert first
            </button>
          </div>
        )}

        {isEnhancing && (
          <div role="status" aria-live="polite" className="flex items-center gap-2 px-1 text-xs text-violet-300">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            <span>{enhanceModelLabel} · {({ preparing: 'Preparing references…', connecting: 'Connecting…', generating: 'Writing enhanced prompt…', finishing: 'Finishing…' })[enhanceStage]}</span>
          </div>
        )}
        {enhanceError && (
          <div className="flex items-start justify-between gap-3 rounded-xl border border-amber-500/30 bg-amber-500/[0.08] px-3.5 py-3 text-xs text-amber-100" role="alert">
            <span>{enhanceError}</span>
            <button type="button" onClick={() => setEnhanceError(null)} aria-label="Dismiss Enhance message" className="shrink-0 text-amber-200 hover:text-white">
              <X className="h-4 w-4" />
            </button>
          </div>
        )}


          {modelInputHint && <p role="status" className="px-1 text-[11px] leading-5 text-gray-400">{modelInputHint}</p>}
          {customSizeHint && <p role="status" className={`px-1 text-xs leading-5 ${sizeAdjustment?.size === getOpenAIImageSize(config) ? 'text-sky-300' : 'text-gray-500'}`}>{customSizeHint}</p>}
        </div>}

        {/* BOTTOM BAR */}
        <div className={PROMPT_TOOLBAR_CLASS}>
            
            {/* Left: Settings Group */}
            <div
                className={PROMPT_SETTINGS_CLASS}
                role="group"
                aria-label="Generation settings"
            >
                
                {/* Template Button - Icon only */}
                <button
                    ref={templateButtonRef}
                    onClick={handleToggleTemplateMenu}
                    title="Templates"
                    className={`flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-xl border transition-all ${
                        isTemplateMenuOpen ? 'border-violet-400/35 bg-violet-500/15 text-violet-200' : 'border-white/[0.07] bg-[#171e28] text-gray-400 hover:border-white/15 hover:bg-[#1b2330] hover:text-white'
                    }`}
                >
                    <LayoutTemplate className="w-5 h-5" />
                </button>

                {/* Template Menu Dropdown */}
                {isTemplateMenuOpen && createPortal(
                    <div 
                        ref={templateMenuRef}
                        style={{
                            position: 'fixed',
                            left: `${templateMenuPos.left}px`,
                            bottom: `${templateMenuPos.bottom}px`,
                            zIndex: 9999
                        }}
                        className="w-[300px] bg-[#161b22] border border-gray-700/50 rounded-2xl shadow-2xl overflow-hidden animate-in slide-in-from-bottom-2 fade-in duration-200"
                    >
                         {/* Header */}
                         <div className="px-4 py-3 bg-gray-900/50 border-b border-gray-800">
                           <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                             <LayoutTemplate className="w-4 h-4 text-violet-400" />
                             Templates
                           </h3>
                         </div>
                         
                         <div className="p-2">
                             {/* Save New */}
                             <div className="mb-2">
                                 {isNamingTemplate ? (
                                     <div className="flex gap-2 p-1">
                                         <input 
                                            type="text" 
                                            autoFocus
                                            value={newTemplateName} 
                                            onChange={(e) => setNewTemplateName(e.target.value)}
                                            placeholder="Template Name..."
                                            className="flex-1 bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500/50"
                                            onKeyDown={(e) => e.key === 'Enter' && handleConfirmSave()}
                                         />
                                         <button onClick={handleConfirmSave} className="px-3 py-2 bg-violet-600 hover:bg-violet-500 rounded-lg text-white font-medium text-sm transition-colors">Save</button>
                                     </div>
                                 ) : (
                                     <button 
                                        onClick={handleSaveClick}
                                        className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-violet-600/20 hover:bg-violet-600/30 border border-violet-500/30 rounded-xl text-sm font-medium text-violet-300 hover:text-violet-200 transition-all"
                                     >
                                         <Plus className="w-4 h-4" />
                                         Save Current Settings
                                     </button>
                                 )}
                             </div>

                             {/* Templates List */}
                             <div className="max-h-[240px] overflow-y-auto space-y-1 custom-scrollbar">
                                 {templates.length === 0 ? (
                                     <div className="text-center py-6 text-gray-500 text-xs">
                                       <LayoutTemplate className="w-8 h-8 mx-auto mb-2 opacity-30" />
                                       No templates yet
                                     </div>
                                 ) : (
                                     templates.map(t => (
                                         <div 
                                           key={t.id} 
                                           className="flex items-center gap-3 group p-3 hover:bg-gray-800/50 rounded-xl transition-all cursor-pointer border border-transparent hover:border-gray-700/50"
                                                onClick={() => {
                                                    onSelectTemplate(t);
                                                    setIsTemplateMenuOpen(false);
                                                }}
                                         >
                                             {/* Template Icon */}
                                             <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-violet-600/20 to-indigo-600/20 border border-violet-500/20 flex items-center justify-center shrink-0">
                                               <LayoutTemplate className="w-5 h-5 text-violet-400" />
                                             </div>
                                             
                                             {/* Template Info */}
                                             <div className="flex-1 min-w-0">
                                                 <span className="text-sm font-medium text-gray-200 group-hover:text-white block truncate">{t.name}</span>
                                                 <div className="flex items-center gap-2 mt-0.5">
                                                   <span className="text-[10px] px-1.5 py-0.5 bg-gray-800 rounded text-gray-400">{t.config.imageModel === SUNBURST_MODEL ? getOpenAIImageSize(t.config) : t.config.resolution}</span>
                                                   {t.config.imageModel !== SUNBURST_MODEL && <span className="text-[10px] px-1.5 py-0.5 bg-gray-800 rounded text-gray-400">{t.config.aspectRatio}</span>}
                                                 </div>
                                             </div>
                                             
                                             {/* Actions */}
                                             <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                                <button 
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        onUpdateTemplate(t);
                                                        setIsTemplateMenuOpen(false);
                                                    }}
                                                    className="p-1.5 hover:bg-blue-500/20 rounded-lg text-gray-500 hover:text-blue-400 transition-all"
                                                    title="Update with current settings"
                                                >
                                                    <RefreshCw className="w-3.5 h-3.5" />
                                                </button>
                                                <button 
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        onDeleteTemplate(t.id);
                                                    }}
                                                    className="p-1.5 hover:bg-red-500/20 rounded-lg text-gray-500 hover:text-red-400 transition-all"
                                                    title="Delete"
                                                >
                                                    <Trash2 className="w-3.5 h-3.5" />
                                                </button>
                                             </div>
                                         </div>
                                     ))
                                 )}
                             </div>
                         </div>
                    </div>,
                    document.body
                )}

                {/* Brainstorm Button - Icon only with badge, hidden in video mode */}
                {!isVideoMode && (<>
                <button
                    ref={brainstormButtonRef}
                    onClick={handleToggleBrainstormPanel}
                    title="Brainstorm Ideas"
                    className={`relative flex items-center justify-center w-[42px] h-[42px] rounded-xl border transition-all shrink-0 ${
                        isBrainstormPreparing
                          ? 'bg-amber-900/30 border-amber-500/50 text-amber-300' 
                          : isBrainstormPanelOpen
                            ? 'bg-amber-900/20 text-amber-400 border-amber-600/50 hover:border-amber-500'
                            : 'border-white/[0.07] bg-[#171e28] text-gray-400 hover:border-amber-500/35 hover:bg-amber-500/[0.06] hover:text-amber-300'
                    }`}
                >
                    {isBrainstormPreparing ? (
                      <Loader2 className="w-5 h-5 animate-spin" />
                    ) : (
                      <Lightbulb className="w-5 h-5" />
                    )}
                </button>

                {/* Brainstorm Panel */}
                {isBrainstormPanelOpen && createPortal(
                    <div 
                        ref={brainstormPanelRef}
                        style={{
                            position: 'fixed',
                            left: `${brainstormPanelPos.left}px`,
                            bottom: `${brainstormPanelPos.bottom}px`,
                            maxHeight: `calc(100dvh - ${brainstormPanelPos.bottom + 16}px)`,
                            zIndex: 9999
                        }}
                        className="w-[400px] max-w-[calc(100vw-32px)] bg-[#0d1117] border border-gray-700 rounded-xl shadow-2xl animate-in slide-in-from-bottom-2 fade-in duration-200 overflow-y-auto custom-scrollbar"
                    >
                        {/* Header */}
                        <div className="p-3 border-b border-gray-800 bg-gradient-to-r from-amber-900/20 to-transparent">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <Lightbulb className="w-4 h-4 text-amber-400" />
                              <span className="text-sm font-semibold text-white">Brainstorm Ideas</span>
                            </div>
                            <button 
                              onClick={() => {
                                setIsBrainstormPanelOpen(false);
                              }}
                              aria-label="Close Brainstorm"
                              className="p-1 text-gray-500 hover:text-white rounded transition-colors"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </div>
                          
                          {/* Category Selector */}
                          <div className="flex gap-1.5 mt-3 overflow-x-auto no-scrollbar pb-1">
                            {[
                              { id: 'simple' as BrainstormCategory, label: 'Simple', icon: Sparkles },
                              { id: 'youtube_thumbnail' as BrainstormCategory, label: 'YouTube', icon: Zap },
                            ].map(cat => (
                              <button
                                key={cat.id}
                                onClick={() => setBrainstormCategory(cat.id)}
                                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[10px] font-semibold uppercase tracking-wide transition-all shrink-0 ${
                                  brainstormCategory === cat.id
                                    ? 'bg-amber-500 text-black'
                                    : 'bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-white'
                                }`}
                              >
                                <cat.icon className="w-3 h-3" />
                                {cat.label}
                              </button>
                            ))}
                          </div>

                          {/* Idea Count Selector */}
                          <div className="mt-3 flex items-center justify-between bg-gray-900/60 border border-gray-800 rounded-lg px-2 py-1.5">
                            <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Idea Count</span>
                            <div className="flex items-center bg-gray-900 border border-gray-700 rounded-lg overflow-hidden">
                              <button
                                onClick={() => setBrainstormIdeaCount(prev => Math.max(MIN_BRAINSTORM_IDEAS, prev - 1))}
                                className="w-7 h-7 flex items-center justify-center text-gray-400 hover:text-white hover:bg-gray-800 transition-colors"
                                disabled={brainstormIdeaCount <= MIN_BRAINSTORM_IDEAS}
                                title={`Minimum ${MIN_BRAINSTORM_IDEAS}`}
                              >
                                <Minus className="w-3.5 h-3.5" />
                              </button>
                              <div className="w-10 text-center text-xs font-bold text-white select-none">{brainstormIdeaCount}</div>
                              <button
                                onClick={() => setBrainstormIdeaCount(prev => Math.min(MAX_BRAINSTORM_IDEAS, prev + 1))}
                                className="w-7 h-7 flex items-center justify-center text-gray-400 hover:text-white hover:bg-gray-800 transition-colors"
                                disabled={brainstormIdeaCount >= MAX_BRAINSTORM_IDEAS}
                                title={`Maximum ${MAX_BRAINSTORM_IDEAS}`}
                              >
                                <Plus className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        </div>

                        <div className="p-4 space-y-3">
                          {(config.youtubeSource || config.referenceImages.find(ref => ref.youtubeSource)?.youtubeSource) && (() => {
                            const source = config.youtubeSource || config.referenceImages.find(ref => ref.youtubeSource)!.youtubeSource!;
                            return <div className="rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs">
                              <p className="line-clamp-2 text-gray-200">{source.title}</p>
                              <p className="mt-1 text-[10px] text-gray-500">{config.youtubeSource ? 'Short brief from video analysis · original cover not added automatically' : source.analysisSource === 'video' ? 'Brief from video content + original cover' : 'Limited brief from title, description + cover'}</p>
                              {source.warning && <p className="mt-1 text-[10px] text-amber-300">{source.warning}</p>}
                              <p className="mt-1 text-[10px] text-gray-500">Your brief is ready in the prompt field and can be edited.</p>
                              <details className="mt-2 text-[10px] text-gray-400">
                                <summary className="cursor-pointer hover:text-gray-200">Source details</summary>
                                <a href={`https://www.youtube.com/watch?v=${source.videoId}`} target="_blank" rel="noreferrer" className="mt-2 inline-block text-red-300 hover:text-red-200">Watch on YouTube</a>
                                {source.brief && <p className="mt-2 whitespace-pre-wrap leading-relaxed">{source.brief}</p>}
                                {!!source.evidence?.length && <ul className="mt-2 space-y-2">
                                  {source.evidence.map((item, index) => <li key={index} className="flex gap-2 leading-relaxed">
                                    <span className="shrink-0 font-mono text-gray-500">{item.timestamp}</span><span>{item.fact}</span>
                                  </li>)}
                                </ul>}
                              </details>
                            </div>;
                          })()}
                          <ImageReferenceSummary references={brainstormInputImages} />
                          <p className="text-xs text-gray-400">{brainstormIdeaCount} ideas × {config.count} image{config.count > 1 ? 's' : ''} = {brainstormImageCount} images</p>
                          <button onClick={handleBrainstorm} aria-label="Generate brainstorm images"
                            disabled={!canBrainstormGenerate}
                            title={brainstormCostPreview.description}
                            className="w-full rounded-xl bg-gradient-to-r from-lime-400 to-emerald-400 px-3 py-3 text-sm font-bold text-black transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:from-gray-800 disabled:to-gray-800 disabled:text-gray-500">
                            <span className="flex items-center justify-center gap-2"><Play className="h-4 w-4 shrink-0" />Brainstorm &amp; generate {brainstormImageCount}</span>
                            <span className="mt-1 block text-xs font-medium">{brainstormCostPreview.label}</span>
                          </button>
                          <p className="text-xs text-gray-400">Close Brainstorm to generate your prompt directly.</p>
                          {brainstormCostPreview.note && <p className="text-center text-[10px] text-gray-400">{brainstormCostPreview.note}</p>}
                          <p className="text-[10px] leading-relaxed text-gray-500">{brainstormCostPreview.basis === 'output' ? 'Output estimate. Prompt, references and Brainstorm text are billed separately.' : 'Image estimate. Brainstorm text usage is billed separately.'}</p>
                          {isBrainstormPreparing && <p role="status" className="text-xs text-amber-300">Preparing in the gallery. Generate again to start another batch.</p>}
                          {!hasBrainstormInput && <p className="text-xs text-gray-500">{brainstormCategory === 'simple' ? 'Describe your concept or add reference images.' : 'Add reference images first.'}</p>}
                          {brainstormError && <p role="alert" className="text-xs text-amber-300">{brainstormError}</p>}
                        </div>
                    </div>,
                    document.body
                )}

                </>)}

                <div className="mx-1 h-7 w-px shrink-0 bg-white/[0.06]" />

                {/* Image/Video Mode Toggle */}
                <div className="flex h-[42px] shrink-0 items-center overflow-hidden rounded-xl border border-white/[0.07] bg-[#171e28] p-1">
                  <button
                    onClick={() => updateConfig('mode', 'image')}
                    className={`px-2.5 h-full flex items-center gap-1 text-xs font-semibold transition-colors ${
                      !isVideoMode ? 'rounded-lg bg-violet-600 text-white shadow-sm' : 'rounded-lg text-gray-400 hover:bg-white/[0.05] hover:text-white'
                    }`}
                    title="Image Generation"
                    aria-label="Image generation"
                    aria-pressed={!isVideoMode}
                  >
                    <ImageIcon className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => updateConfig('mode', 'video')}
                    className={`px-2.5 h-full flex items-center gap-1 text-xs font-semibold transition-colors ${
                      isVideoMode ? 'rounded-lg bg-violet-600 text-white shadow-sm' : 'rounded-lg text-gray-400 hover:bg-white/[0.05] hover:text-white'
                    }`}
                    title={`Video Generation (${selectedVideoModel === 'seedance-2.0' ? 'Seedance 2.0' : selectedVideoModel === 'seedance-2.5' ? providerRoute.provider === 'evolink' ? 'Seedance 2.5 Relaxed' : 'Seedance 2.5' : 'MiniMax H3 Max'})`}
                    aria-label="Video generation"
                    aria-pressed={isVideoMode}
                  >
                    <Video className="w-3.5 h-3.5" />
                  </button>
                </div>

                {isVideoMode ? (
                  <>
                    <Dropdown label="Model" value={selectedVideoModel} options={videoModelOptions} onSelect={(val: VideoModelId) => updateVideoModel(val)} icon={Video} compact />
                    {isH3VideoConfig && <Dropdown label="H3 Max action" value={h3State.available ? h3State.mode : 'Choose action'} options={H3_MAX_MODE_OPTIONS} onSelect={updateH3Mode} icon={Film} compact />}
                    {(selectedVideoModel === 'seedance-2.0' || selectedVideoModel === 'seedance-2.5') && (
                      <Dropdown label="Action" value={selectedVideoIntent} options={videoOperationOptions} onSelect={(val: VideoPromptIntent) => updateVideoOperation(val)} icon={Film} compact />
                    )}
                    {selectedVideoModel === 'seedance-2.5' && selectedVideoOperation === 'generate' && config.referenceImages.length > 0 && (
                      <Dropdown label="Video input" value={hasSeedanceFrameRoles ? 'frames' : 'references'} options={[
                        { label: 'References', value: 'references' },
                        { label: 'First / last frames', value: 'frames', disabled: !canAssignSeedanceFrames },
                      ]} onSelect={updateSeedanceInput} icon={ImageIcon} compact />
                    )}
                    {(!isH3VideoConfig || videoAspectRatioOptions.length > 0) && <Dropdown label="Ratio" value={usesSourceFrameAspectRatio ? 'adaptive' : config.videoAspectRatio} options={videoAspectRatioOptions} onSelect={(val: VideoAspectRatio) => updateConfig('videoAspectRatio', val)} icon={Ratio} compact />}
                    <Dropdown label="Quality" value={config.videoQuality} options={videoQualityOptions} onSelect={(val: VideoQuality) => updateConfig('videoQuality', val)} icon={Scan} compact />
                    {isH3VideoConfig ? <>
                      <H3MaxDuration config={config} onChange={onChange} />
                      <H3MaxSettings config={config} onChange={onChange} />
                    </> : <Dropdown label="Duration" value={String(config.videoDuration)} options={videoDurationOptions} onSelect={(val: string) => updateConfig('videoDuration', Number(val) as VideoDuration)} icon={Clock} compact />}
                  </>
                ) : (
                  <>
                    <Dropdown label="Model" value={config.imageModel} options={imageModelOptions} onSelect={(val) => updateConfig('imageModel', val)} icon={ImageIcon} compact />
                    {isSunburst ? <OpenAIImageSettings config={config} onChange={onChange} onSizeAdjustment={setSizeAdjustment} /> : <>
                      <Dropdown label="Aspect Ratio" value={config.aspectRatio} options={aspectRatioOptions} onSelect={(val) => updateConfig('aspectRatio', val)} icon={Ratio} compact />
                      <Dropdown label="Resolution" value={config.resolution} options={resolutionOptions} onSelect={(val) => updateConfig('resolution', val)} icon={Scan} compact />
                    </>}
                    <ImageCountControl count={config.count} onChange={value => updateConfig('count', value)} />
                  </>
                )}
            </div>

            {/* Right: Actions */}
            <div className={PROMPT_ACTIONS_CLASS}>
                {preEnhancePrompt !== null && (
                  <button
                    onClick={handleRevertEnhancedPrompt}
                    aria-label="Revert to original prompt"
                    disabled={!h3PromptSupported}
                    className={`${PROMPT_REVERT_CLASS} disabled:cursor-not-allowed disabled:opacity-40`}
                    title="Restore the brief before Enhance or Brainstorm"
                  >
                    <RotateCcw className="w-4 h-4" />
                    <span>Revert</span>
                  </button>
                )}
                <button
                    onClick={handleEnhance}
                    disabled={isDraftLoading || isEnhancing || !hasEnhanceInput || hasStaleEnhancedPrompt}
                    aria-label="Enhance prompt"
                    className={promptEnhanceClass(isEnhancing, hasStaleEnhancedPrompt)}
                    title={isEnhancing
                      ? 'Enhancing...'
                      : hasStaleEnhancedPrompt
                        ? 'Revert the old enhanced prompt before enhancing for the new model, action, or references'
                      : isH3VideoConfig
                        ? h3PromptSupported ? 'Improve the prompt for this action' : 'This action uses its attached media without a text prompt'
                        : 'Enhance prompt'}
                >
                    {isEnhancing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
                </button>

                 <button
                    onClick={handleGenerate}
                    disabled={!canGenerate}
                    title={isDraftLoading ? 'Loading saved references...'
                      : isBrainstormActive
                      ? 'Use Brainstorm & generate in the open panel, or close Brainstorm to generate your prompt directly.'
                      : uploadingReferenceVideos > 0
                      ? `Uploading ${uploadingReferenceVideos} reference video${uploadingReferenceVideos === 1 ? '' : 's'}...`
                      : hasStaleEnhancedPrompt
                      ? 'Revert and enhance again for the selected model, action, or references'
                      : modelInputError
                        ? modelInputError
                        : !isVideoMode ? imageCostPreview.description : isH3VideoConfig ? 'Published estimate including reference processing; final billing depends on the generated output and supplied media.' : undefined}
                    className={promptGenerateClass(canGenerate)}
                >
                    {/* Progress Bar Background */}
                    {activeRequests > 0 && generationProgress && (
                      <div
                        className={`absolute inset-y-0 left-0 transition-all duration-300 ${busyProgressFillClass}`}
                        style={{ width: `${Math.round((generationProgress.completed / generationProgress.total) * 100)}%` }}
                      />
                    )}

                    <div className="relative z-10 flex flex-col items-center gap-0.5 leading-tight">
                      {isDraftLoading ? <span className={`flex items-center gap-1.5 text-xs ${busyLabelClass}`}><Loader2 className={`h-3.5 w-3.5 shrink-0 animate-spin ${busySpinnerClass}`} />Loading references...</span> : uploadingReferenceVideos > 0 ? (
                          <span className={`flex items-center gap-1.5 text-xs ${busyLabelClass}`}>
                            <Loader2 className={`h-3.5 w-3.5 shrink-0 animate-spin ${busySpinnerClass}`} />
                            Uploading video...
                          </span>
                      ) : activeRequests > 0 ? (
                          <>
                            <span className={`flex items-center gap-1.5 whitespace-nowrap text-xs ${busyLabelClass}`}>
                              <Loader2 className={`h-3.5 w-3.5 shrink-0 animate-spin ${busySpinnerClass}`} />
                              {generationProgress
                                ? `${generationProgress.completed}/${generationProgress.total}`
                                : `Generating (${activeRequests})`
                              }
                            </span>
                            {/* Cost of the NEXT queued generation if the user clicks again */}
                            {canGenerate && (
                              <span className="whitespace-nowrap text-[10px] font-medium text-black/70">
                                +{isVideoMode && videoCost
                                  ? `$${videoCost.usd.toFixed(2)}`
                                  : isVideoMode ? 'Provider usage-based' : imageCostLabel}
                              </span>
                            )}
                          </>
                      ) : (
                          <>
                              <span className="flex items-center gap-1.5 whitespace-nowrap text-xs">
                                {hasStaleEnhancedPrompt ? 'Re-enhance required' : isVideoMode ? videoActionLabel : 'Generate image'}
                                {hasStaleEnhancedPrompt
                                  ? <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                                  : <Sparkles className="h-3.5 w-3.5 shrink-0 fill-black" />}
                              </span>
                              {!hasStaleEnhancedPrompt && (
                                <span className="whitespace-nowrap text-[10px] font-medium opacity-80">
                                  {isVideoMode ? videoCost ? `~$${videoCost.usd.toFixed(2)}` : 'Provider usage-based' : imageCostLabel}
                                </span>
                              )}
                          </>
                      )}
                    </div>
                </button>
            </div>
        </div>

      </div>
    </div>
  );
};
