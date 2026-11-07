// Docker replacement for api/_lib/imageJobQueue.ts (Vercel Queues). Delivery
// semantics match the hosted worker: at-least-once, `ImageJobWait` defers by its
// own delay, any other failure retries after 60 s. Durability stays in Postgres:
// the sweep re-publishes every unfinished job from `image_job_outbox`, so jobs
// held in memory during a restart are recovered within five minutes.
import { createServiceRoleClient } from '../../api/_lib/auth.ts';
import { runImageJob, ImageJobWait } from '../../api/_lib/imageJobRunner.ts';

export const IMAGE_JOB_TOPIC = 'banana-image-jobs';
const concurrency = Math.max(1, Number(process.env.BANANA_IMAGE_WORKERS) || 4);
const scheduled = new Map();
const running = new Set();
let draining = false, drained = null;

/** Process one image job; any failure reschedules it (after the job's own delay, else 60 s). */
const run = async job => {
  try {
    const db = createServiceRoleClient();
    if (!db) throw new Error('Image worker storage is unavailable.');
    await runImageJob(db, job);
  } catch (error) {
    schedule(job, (error instanceof ImageJobWait ? error.afterSeconds : 60) * 1000);
  }
};
/** Start due jobs until the worker limit is reached. */
const pump = () => {
  if (draining) { if (!running.size) drained?.(); return; }
  const now = Date.now();
  for (const [id, { job, due }] of scheduled) {
    if (running.size >= concurrency) break;
    if (running.has(id) || due > now) continue;
    scheduled.delete(id); running.add(id);
    void run(job).finally(() => { running.delete(id); pump(); });
  }
};
/** Queue a job to run after `delay` ms, keeping the earlier time if it is already queued. */
const schedule = (job, delay) => {
  const due = Date.now() + delay, current = scheduled.get(job.id);
  if (!current || current.due > due) scheduled.set(job.id, { job: { id: job.id, userId: job.userId }, due });
  pump();
};
setInterval(pump, 1000).unref();

/**
 * Stop starting jobs and resolve once the running ones have finished, so a
 * stop (`docker compose stop`, an update, a backup) never cuts off a paid
 * generation before its result is saved. Queued jobs stay in Postgres and the
 * sweep re-publishes them after the next start.
 */
export const drainImageJobs = () => new Promise(resolve => { draining = true; drained = resolve; pump(); });

/** Same contract as the hosted queue: deliver, then confirm publication in Postgres. */
export const publishImageJob = async (db, job) => {
  schedule(job, 0);
  const { error } = await db.rpc('mark_image_job_published', { p_id: job.id });
  if (error) throw new Error('Queue publication confirmation is unavailable.');
};
