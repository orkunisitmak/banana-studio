import type { GeneratedMedia } from '../../types';

export const STUCK_PENDING_MS = 90_000;

/** A pending row that will never progress without a provider task ID. Video
 * needs one to resume; legacy fal image rows need their request ID. Queued
 * image jobs (every current image model) wait server-side for a worker slot
 * and never get a task ID, so they are never stuck by this rule. */
export const isStuckPendingGeneration = (item: GeneratedMedia, now: number, ownImageJobs: ReadonlySet<string>): boolean => {
  if (item.status !== 'pending' || now - item.createdAt <= STUCK_PENDING_MS) return false;
  if (item.mediaType === 'video') return !item.taskId;
  return item.mediaType === 'image' && item.imageModel !== 'gpt-image-2.5-sunburst' && !item.falRequestId
    && !item.imageQueue && !item.imageStage && !ownImageJobs.has(item.id);
};
