export type ImageSubmissionStage = 'preparing' | 'queued' | 'generating';

/** A presentation callback must not interrupt accepted provider work or polling. */
export const createImageStageNotifier = (
  onStage?: (stage: ImageSubmissionStage, waitReason?: 'rate' | 'quota') => void,
) => {
  let detached = false;
  return (stage: ImageSubmissionStage, waitReason?: 'rate' | 'quota'): void => {
    if (!onStage || detached) return;
    try { onStage(stage, waitReason); }
    catch { detached = true; }
  };
};

type Ticket = {
  waitForCapacity(checkSession: () => Promise<void>): Promise<void>;
  defer(milliseconds: number): void;
  generating(): void;
};

/** One FIFO for all image batches in this tab. The server remains the authority
 * across tabs/users; only an explicit pre-provider refusal can defer a ticket. */
export const createImageGenerationQueue = ({
  concurrency = 8,
  now = () => Date.now(),
  sleep = (milliseconds: number) => new Promise<void>(resolve => setTimeout(resolve, milliseconds)),
} = {}) => {
  if (!Number.isInteger(concurrency) || concurrency < 1) throw new Error('Image concurrency must be a positive integer.');
  const jobs = new Map<string, { promise: Promise<unknown>; stage: ImageSubmissionStage; listeners: Set<(stage: ImageSubmissionStage) => void> }>();
  const waiting: (() => void)[] = [];
  const cooldowns = new Map<string, number>();
  let active = 0;
  const drain = () => {
    while (active < concurrency && waiting.length) { active++; waiting.shift()!(); }
  };
  return {
    run<T>(owner: string, id: string, work: (ticket: Ticket) => Promise<T>, onStage?: (stage: ImageSubmissionStage) => void): Promise<T> {
      const key = JSON.stringify([owner, id]);
      const existing = jobs.get(key);
      if (existing) {
        if (onStage) { existing.listeners.add(onStage); try { onStage(existing.stage); } catch { existing.listeners.delete(onStage); } }
        return existing.promise as Promise<T>;
      }
      let resolve!: (result: T) => void, reject!: (error: unknown) => void;
      const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
      const job = { promise, stage: 'queued' as ImageSubmissionStage, listeners: new Set(onStage ? [onStage] : []) };
      jobs.set(key, job);
      const stage = (value: ImageSubmissionStage) => { job.stage = value; job.listeners.forEach(listener => { try { listener(value); } catch { job.listeners.delete(listener); } }); };
      stage('queued');
      waiting.push(() => {
        const ticket: Ticket = {
          async waitForCapacity(checkSession) {
            await checkSession();
            while ((cooldowns.get(owner) || 0) > now()) {
              stage('queued');
              await sleep(Math.min(30_000, cooldowns.get(owner)! - now()));
              await checkSession();
            }
            cooldowns.delete(owner);
          },
          defer(milliseconds) {
            cooldowns.set(owner, Math.max(cooldowns.get(owner) || 0, now() + milliseconds));
            stage('queued');
          },
          generating: () => stage('generating'),
        };
        void Promise.resolve().then(() => work(ticket)).then(resolve, reject).finally(() => {
          jobs.delete(key); active--; drain();
        });
      });
      drain();
      return promise;
    },
  };
};

export const imageGenerationQueue = createImageGenerationQueue();

/** This code is emitted only by our admission guard, before an image-provider
 * call or generation row exists. Upstream 429/5xx and lost responses never qualify. */
export const getImageCapacityDelay = (status: number, body: unknown): number | undefined => {
  const data = body as { code?: unknown; providerRequestSent?: unknown; retryAfter?: unknown } | null;
  if (status !== 429 || data?.code !== 'IMAGE_CAPACITY_WAIT' || data.providerRequestSent !== false
    || typeof data.retryAfter !== 'number' || !Number.isFinite(data.retryAfter) || data.retryAfter <= 0 || data.retryAfter > 86_400) return;
  return Math.max(1_000, data.retryAfter * 1_000);
};
