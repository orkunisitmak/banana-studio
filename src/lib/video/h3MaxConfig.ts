import type { GenerationConfig, ReferenceImage } from '../../types.js';
import { normalizeH3MaxPromptLanguage } from './h3MaxPromptGuide.js';
import { buildH3MaxInput, H3_MAX_CAPABILITIES, isH3MaxModeAvailable, resolveH3MaxMode, type H3MaxOptions } from './h3Max.js';

export const getH3MaxMode = (config: Pick<GenerationConfig,'h3MaxMode'|'referenceImages'|'referenceVideos'|'referenceAudios'>) => resolveH3MaxMode(config.h3MaxMode,{
  images:config.referenceImages?.length||0,videos:config.referenceVideos?.length||0,audios:config.referenceAudios?.length||0,
});

/** The composer offers only settings valid for the attached media. The API
 * retains its precise fractional bounds for historical and external requests. */
export const getH3MaxDraftCapabilities = (config: GenerationConfig) => {
  const mode = getH3MaxMode(config), capability = H3_MAX_CAPABILITIES[mode];
  return { ...capability,
    duration: capability.duration && (mode === 'text_to_video' || mode === 'image_to_video') && config.referenceAudios?.length
      ? { ...capability.duration, min: 2 } : capability.duration,
    resolutions: mode === 'reference_to_video' && config.h3MaxOptions?.middleImageId
      ? capability.resolutions.filter(value => value !== '1080P') : capability.resolutions,
    aspectRatios: mode === 'reference_to_video' && config.h3MaxOptions?.startImageId
      ? ['adaptive'] : capability.aspectRatios,
  };
};

export const getH3MaxDurationSeconds = (config: GenerationConfig): number => {
  const bounds = getH3MaxDraftCapabilities(config).duration;
  if (!bounds) return config.videoDuration;
  const value = Number.isFinite(config.videoDuration) && config.videoDuration > 0 ? config.videoDuration : bounds.default;
  return Math.max(Math.ceil(bounds.min), Math.min(Math.floor(bounds.max), Math.round(value)));
};

export type H3MaxImageRole = 'start' | 'middle' | 'end' | 'reference';
const frameIds = ['startImageId','middleImageId','endImageId'] as const;
const sameOptions = (left: Partial<H3MaxOptions> = {}, right: Partial<H3MaxOptions> = {}) => {
  const keys = Object.keys(left) as Array<keyof H3MaxOptions>;
  return keys.length === Object.keys(right).length && keys.every(key => left[key] === right[key]);
};

/** Old saved options stay readable; each new composer request gets a random
 * provider seed and resolves frame access from its attached stable IDs. */
export const sanitizeH3MaxDraftOptions = (options?: Partial<H3MaxOptions>): Partial<H3MaxOptions> => {
  const sanitized = { ...options };
  delete sanitized.seed;
  delete sanitized.startImageUrl; delete sanitized.middleImageUrl; delete sanitized.endImageUrl;
  return sanitized;
};

const markImageFrame = (image: ReferenceImage, first: boolean, last: boolean): ReferenceImage => {
  if (!!image.isFirstFrame === first && !!image.isLastFrame === last) return image;
  return { ...image, isFirstFrame: first || undefined, isLastFrame: last || undefined };
};

/** Freeze a legacy inferred choice once. Later attachment changes must not
 * switch the selected action. Keep object identity when normalization is idle. */
export const normalizeH3MaxDraft = (config: GenerationConfig): GenerationConfig => {
  const mode = getH3MaxMode(config);
  let options = sanitizeH3MaxDraftOptions(config.h3MaxOptions);
  let images = config.referenceImages;
  if (mode === 'image_to_video') {
    if (images.length > 1 && options.imageFrame === 'end') {
      const end = images.find(image => image.isLastFrame) || images[0];
      const start = images.find(image => image !== end && image.isFirstFrame) || images.find(image => image !== end)!;
      options.imageFrame = 'start';
      images = images.map(image => markImageFrame(image, image === start, image === end));
      images = getH3MaxReferenceImages({ ...config, h3MaxMode: mode, referenceImages: images });
    } else if (images.length === 1) {
      if (images[0].isLastFrame && !images[0].isFirstFrame) options.imageFrame = 'end';
      else if (images[0].isFirstFrame && options.imageFrame === 'end') options.imageFrame = 'start';
    }
  }
  let videoDuration = config.videoDuration, videoQuality = config.videoQuality, videoAspectRatio = config.videoAspectRatio;
  if (isH3MaxModeAvailable(mode)) {
    const capabilities = getH3MaxDraftCapabilities(config);
    videoDuration = getH3MaxDurationSeconds(config);
    const resolution = capabilities.resolutions.find(value => value.toLowerCase() === config.videoQuality.toLowerCase())
      || capabilities.resolutions.find(value => value === '768P') || capabilities.resolutions[0];
    videoQuality = (resolution === '2K' ? '2K' : resolution.toLowerCase()) as GenerationConfig['videoQuality'];
    const ratios = capabilities.aspectRatios.map(value => value === 'auto' ? 'adaptive' : value);
    videoAspectRatio = (!ratios.length ? 'adaptive' : ratios.includes(config.videoAspectRatio) ? config.videoAspectRatio
      : ratios.includes('adaptive') ? 'adaptive' : '16:9') as GenerationConfig['videoAspectRatio'];
    if (mode === 'reference_to_video' && options.middleImageId
      && (!Number.isFinite(options.middleFrameTime) || options.middleFrameTime! <= 0 || options.middleFrameTime! >= videoDuration
        || Math.round(options.middleFrameTime! * 24) <= 0 || Math.round(options.middleFrameTime! * 24) >= Math.round(videoDuration * 24))) {
      options.middleFrameTime = videoDuration / 2;
    }
  }
  if (mode === config.h3MaxMode && images === config.referenceImages && sameOptions(config.h3MaxOptions, options)
    && videoDuration === config.videoDuration && videoQuality === config.videoQuality && videoAspectRatio === config.videoAspectRatio) return config;
  return { ...config, h3MaxMode: mode, referenceImages: images,
    videoDuration, videoQuality, videoAspectRatio,
    ...(config.h3MaxOptions || Object.keys(options).length ? { h3MaxOptions: options } : {}),
  };
};

/** Assign a frame on the existing draft without deleting or replacing any
 * attachment. R2V photos have one role; I2V always has opening/closing frames. */
export const setH3MaxImageRole = (config: GenerationConfig, imageId: string, role: H3MaxImageRole): GenerationConfig => {
  if (!['start','middle','end','reference'].includes(role)) throw new Error('Invalid H3 Max image role.');
  if (!config.referenceImages.some(image => image.id === imageId)) throw new Error('The selected H3 Max image is no longer attached.');
  const mode = getH3MaxMode(config);
  if (mode !== 'reference_to_video' && mode !== 'image_to_video') throw new Error('Frame roles are available only for Image to Video and Reference to Video.');
  if (mode === 'image_to_video' && (role === 'middle' || role === 'reference')) throw new Error('Image to Video accepts only first or last frame roles.');
  const options = sanitizeH3MaxDraftOptions(config.h3MaxOptions);
  let images: ReferenceImage[];
  if (mode === 'reference_to_video') {
    const attached = new Set(config.referenceImages.map(image => image.id)), used = new Set<string>();
    for (const key of frameIds) {
      const id = options[key];
      if (!id || id === imageId || !attached.has(id) || used.has(id)) delete options[key];
      else used.add(id);
    }
    if (role !== 'reference') options[role === 'start' ? 'startImageId' : role === 'end' ? 'endImageId' : 'middleImageId'] = imageId;
    if (!options.middleImageId) delete options.middleFrameTime;
    else {
      const duration = Number.isFinite(config.videoDuration) && config.videoDuration > 0 ? config.videoDuration : H3_MAX_CAPABILITIES.reference_to_video.duration!.default;
      if (!Number.isFinite(options.middleFrameTime) || options.middleFrameTime! <= 0 || options.middleFrameTime! >= duration) options.middleFrameTime = duration / 2;
    }
    delete options.imageFrame;
    images = config.referenceImages.map(image => markImageFrame(image, false, false));
  } else {
    for (const key of frameIds) delete options[key];
    delete options.middleFrameTime;
    const selected = config.referenceImages.find(image => image.id === imageId)!;
    const others = config.referenceImages.filter(image => image !== selected);
    const first = role === 'start' ? selected : others.find(image => image.isFirstFrame) || others[0];
    const last = role === 'end' ? selected : others.find(image => image.isLastFrame) || others[0];
    options.imageFrame = first ? 'start' : 'end';
    images = config.referenceImages.map(image => markImageFrame(image, image === first, image === last));
    images = getH3MaxReferenceImages({ ...config, h3MaxMode: mode, referenceImages: images });
  }
  const unchangedImages = images.every((image, index) => image === config.referenceImages[index]);
  if (mode === config.h3MaxMode && unchangedImages && sameOptions(config.h3MaxOptions, options)) return config;
  return normalizeH3MaxDraft({ ...config, h3MaxMode: mode, referenceImages: images, h3MaxOptions: options });
};

export const removeH3MaxReferenceImages = (config: GenerationConfig, removedIds: ReadonlySet<string>): GenerationConfig => {
  const mode = getH3MaxMode(config);
  let images = config.referenceImages.filter(image => !removedIds.has(image.id));
  const options = sanitizeH3MaxDraftOptions(config.h3MaxOptions);
  for (const key of frameIds) if (options[key] && removedIds.has(options[key]!)) delete options[key];
  if (!options.middleImageId) delete options.middleFrameTime;
  if (mode === 'image_to_video') {
    if (!images.length) delete options.imageFrame;
    else if (images.length === 1) {
      const originalOrder = getH3MaxReferenceImages(config);
      const previousEnd = originalOrder.find(image => image.isLastFrame)
        || (originalOrder.length > 1 ? originalOrder.at(-1) : config.h3MaxOptions?.imageFrame === 'end' ? originalOrder[0] : undefined);
      const isEnd = images[0].id === previousEnd?.id;
      options.imageFrame = isEnd ? 'end' : 'start';
      images = images.map(image => markImageFrame(image, !isEnd, isEnd));
    }
  }
  return normalizeH3MaxDraft({ ...config, h3MaxMode: mode, referenceImages: images, h3MaxOptions: options });
};

/** The numbered image list must match the provider, independent of keyframes. */
export const getH3MaxReferenceImages = (config: GenerationConfig): ReferenceImage[] => {
  const images=config.referenceImages||[],mode=getH3MaxMode(config);
  if(mode==='reference_to_video'){
    const options=config.h3MaxOptions||{};
    const frameIds=new Set([options.startImageId,options.endImageId,options.middleImageId].filter(Boolean));
    return images.filter(image=>!frameIds.has(image.id));
  }
  if(mode==='image_to_video')return [...images].sort((a,b)=>{
    const rank=(image:ReferenceImage)=>image.isFirstFrame?-1:image.isLastFrame?1:0;
    return rank(a)-rank(b);
  });
  return images;
};

/** Resolve stable attached-image IDs at submission, after private URL renewal. */
export const getH3MaxSubmissionOptions = (config: GenerationConfig, urls?: Map<string,string>): Partial<H3MaxOptions> => {
  const options=sanitizeH3MaxDraftOptions(config.h3MaxOptions);
  // Composer keyframes are identified by attached IDs, never cached bearer URLs.
  if(options.referenceConditions?.length)throw new Error('Attach H3 Max references in the composer before generating.');
  options.promptExpansionMode=options.promptExpansionMode||(config.videoPromptExpansionMode==='quality'||config.videoPromptExpansionMode==='disabled'?config.videoPromptExpansionMode:'balanced');
  if(getH3MaxMode(config)!=='reference_to_video'){
    delete options.startImageId;delete options.endImageId;delete options.middleImageId;delete options.middleFrameTime;
    return options;
  }
  if(!options.middleImageId)delete options.middleFrameTime;
  for(const [idKey,urlKey] of [['startImageId','startImageUrl'],['endImageId','endImageUrl'],['middleImageId','middleImageUrl']] as const){
    if(!options[idKey])continue;
    const image=config.referenceImages.find(image=>image.id===options[idKey]);
    if(!image)throw new Error('A selected H3 Max keyframe is no longer attached. Choose it again.');
    options[urlKey]=urls?.get(image.id)||`https://pending.invalid/${encodeURIComponent(image.id)}.png`;
  }
  return options;
};

export const getKnownVideoDuration = (duration?:number):number|undefined => duration!==undefined&&Number.isFinite(duration)&&duration>0?duration:undefined;

export const getH3MaxRequestBody = (config:GenerationConfig,media?:{images:Map<string,string>;videos:string[];audios:string[]}) => {
  const mode=getH3MaxMode(config),options=getH3MaxSubmissionOptions(config,media?.images);
  // Validate the prompt as it is submitted: tags like @VIDEO expand into longer words.
  const prompt=H3_MAX_CAPABILITIES[mode].prompt==='unsupported'?undefined:normalizeH3MaxPromptLanguage(config.prompt,{mode,options:config.h3MaxOptions},{images:config.referenceImages,videos:config.referenceVideos||[],audios:config.referenceAudios||[]});
  return {mode,prompt,
    duration:config.videoDuration,resolution:config.videoQuality.toUpperCase(),aspectRatio:config.videoAspectRatio,
    imageUrls:getH3MaxReferenceImages(config).map(image=>media?.images.get(image.id)||`https://pending.invalid/${encodeURIComponent(image.id)}.png`),
    videoUrls:media?.videos||(config.referenceVideos||[]).map((_,index)=>`https://pending.invalid/video-${index}.mp4`),
    audioUrls:media?.audios||(config.referenceAudios||[]).map((_,index)=>`https://pending.invalid/audio-${index}.wav`),options,
    mediaMetadata:{images:getH3MaxReferenceImages(config).map(ref=>({width:ref.width,height:ref.height})),
      videos:(config.referenceVideos||[]).map(ref=>({duration:getKnownVideoDuration(ref.duration),width:ref.width,height:ref.height,size:ref.size})),
      audios:(config.referenceAudios||[]).map(ref=>({duration:ref.duration,size:ref.size}))},
  };
};
export const getH3MaxConfigError = (config:GenerationConfig):string|null => {
  try{buildH3MaxInput(getH3MaxRequestBody(config));return null;}catch(error){return error instanceof Error?error.message:'Invalid H3 Max inputs.';}
};
