import { useEffect } from 'react';
import type { GeneratedMedia } from '../../types';

/** A video without a provider task ID cannot resume after the page closes:
 * the reload marks it "interrupted before task was created". Saving a finished
 * video resumes from its task ID, so only the submission is at risk. */
export const hasUnresumableVideoSubmission = (media: GeneratedMedia[]): boolean =>
  media.some(item => item.mediaType === 'video' && !!item.isLoading && item.videoStage === 'generating' && !item.taskId);

/** Ask the browser to confirm closing or reloading only while `active` is true. */
export const useUnloadWarning = (active: boolean): void => {
  useEffect(() => {
    if (!active) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [active]);
};
