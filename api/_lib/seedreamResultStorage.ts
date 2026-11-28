import { createHash } from 'node:crypto';
import type { SupabaseClient as Client } from '@supabase/supabase-js';
import { SEEDREAM_MAX_IMAGES, SEEDREAM_MAX_LAYER_IMAGES, type SeedreamImage, type SeedreamResult } from '../../src/lib/images/seedream55.js';
import { estimateSeedreamCost } from '../../src/lib/images/seedreamPricing.js';
import { fetchFalRequestCosts } from './falBillingCosts.js';
import { canonicalMediaUrl } from './imageStorage.js';
import { readImageDimensions } from './imageDimensions.js';

const MAX_FILE_BYTES = 48 * 1024 * 1024;
/** A completed result cannot be archived; polling the provider again cannot fix it. */
export class SeedreamArchiveRejected extends Error {}
// The provider handle is opaque, not a storage path component.
const prefixFor = (owner: string, task: string) => `${owner}/seedream/${createHash('sha256').update(task).digest('hex')}/`;

const readGeneration = async (db: Client, owner: string, task: string, endpoint: string) => {
  const { data, error } = await db.from('generations').select('id,status,metadata,created_at,reference_images,prompt')
    .eq('user_id', owner).eq('task_id', task).eq('metadata->>falEndpoint', endpoint).eq('image_model', 'seedream-5.5').maybeSingle();
  if (error) throw new Error('Could not read the saved Seedream generation.');
  return data;
};

function withUrls(result: SeedreamResult, urls: string[]): SeedreamResult {
  return {
    images: result.images.map((image, i) => ({ ...image, url: urls[i] })),
    ...(result.layers ? { layers: result.layers.map((layer, i) => ({ ...layer, image: { ...layer.image, url: urls[i] } })) } : {}),
  };
}

async function signResult(db: Client, paths: string[], result: SeedreamResult) {
  const { data, error } = await db.storage.from('media').createSignedUrls(paths, 15 * 60);
  const links = new Map((data ?? []).map(entry => [entry.path, entry.signedUrl]));
  if (error || paths.some(path => !links.get(path))) throw new Error('Could not authorize the archived Seedream images.');
  return withUrls(result, paths.map(path => links.get(path)!));
}

/** Called after the route authorizes the provider task. A reconnect never dispatches generation. */
export async function readArchivedSeedreamResult(db: Client, owner: string, task: string, endpoint: string): Promise<SeedreamResult | null> {
  const row = await readGeneration(db, owner, task, endpoint);
  const result: SeedreamResult | undefined = row?.metadata?.seedreamResult;
  if (row?.status !== 'completed' || !result?.images?.length) return null;
  if (!Array.isArray(result.images) || result.images.length > (endpoint.endsWith('/layerize') ? SEEDREAM_MAX_LAYER_IMAGES : SEEDREAM_MAX_IMAGES)
    || result.layers && (!Array.isArray(result.layers) || result.layers.length !== result.images.length)) throw new Error('Invalid saved Seedream manifest.');
  // Only mint links inside this task's own namespace, not arbitrary URLs from editable metadata.
  const prefix = prefixFor(owner, task);
  const paths = result.images.map(({ url }, index) => {
    const ext = url.endsWith('.jpg') ? 'jpg' : 'png';
    const path = `${prefix}${index}.${ext}`;
    if (!url.endsWith(`/object/authenticated/media/${path}`)) throw new Error('Invalid saved Seedream image path.');
    return path;
  });
  return signResult(db, paths, result);
}

async function imageBytes(source: string): Promise<Buffer> {
  if (source.startsWith('data:')) {
    const header = /^data:image\/(?:jpeg|png);base64,/i.exec(source);
    if (!header) throw new SeedreamArchiveRejected('Invalid inline Seedream image.');
    if (source.length - header[0].length > 4 * Math.ceil(MAX_FILE_BYTES / 3)) throw new SeedreamArchiveRejected('Seedream image exceeds the storage limit.');
    const payload = source.slice(header[0].length);
    if (!payload || payload.length % 4 === 1 || !/^[a-z\d+/]+={0,2}$/i.test(payload)) throw new SeedreamArchiveRejected('Invalid inline Seedream image.');
    const bytes = Buffer.from(payload, 'base64');
    if (bytes.length > MAX_FILE_BYTES) throw new SeedreamArchiveRejected('Seedream image exceeds the storage limit.');
    return bytes;
  }
  let url: URL;
  try { url = new URL(source); } catch { throw new SeedreamArchiveRejected('Invalid Seedream image location.'); }
  if (url.protocol !== 'https:' || url.port || url.username || url.password ||
      !(url.hostname === 'fal.media' || url.hostname.endsWith('.fal.media') || url.hostname === 'storage.googleapis.com' && url.pathname.startsWith('/falserverless/'))) {
    throw new SeedreamArchiveRejected('Unexpected Seedream image host.');
  }
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(60_000) });
  if (response.status === 410) throw new SeedreamArchiveRejected('The completed Seedream image is no longer available.');
  if (!response.ok) throw new Error('Could not retrieve a Seedream image.');
  if (!response.body) throw new SeedreamArchiveRejected('The completed Seedream image was empty.');
  if (Number(response.headers.get('content-length')) > MAX_FILE_BYTES) {
    await response.body.cancel().catch(() => {});
    throw new SeedreamArchiveRejected('Seedream image exceeds the storage limit.');
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if ((size += value.length) > MAX_FILE_BYTES) throw new SeedreamArchiveRejected('Seedream image exceeds the storage limit.');
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  return Buffer.concat(chunks, size);
}

/** Never delete files on a failed lookup or while another row still owns the task. */
async function discardDeletedTask(db: Client, owner: string, task: string, paths?: string[]): Promise<never> {
  const { data, error } = await db.from('generations').select('id').eq('user_id', owner).eq('task_id', task).limit(1);
  if (error || !Array.isArray(data)) throw new Error('Could not confirm deletion of the Seedream generation.');
  if (!data.length) {
    const prefix = prefixFor(owner, task);
    // On a later reconnect the previous upload list is no longer in memory.
    // Enumerate only the fixed names this registered task could have written.
    const keys = paths ?? Array.from({length: SEEDREAM_MAX_LAYER_IMAGES}, (_, i) => [prefix + i + '.png', prefix + i + '.jpg']).flat();
    const { error: cleanupError } = await db.storage.from('media').remove(keys);
    if (cleanupError) throw new Error('Could not remove orphaned Seedream outputs.');
  }
  throw new SeedreamArchiveRejected('The saved Seedream generation no longer owns this task.');
}

/** Upload all outputs first; only then replace the pending row with a completed manifest.
 * Deterministic object names and an UPDATE (never an INSERT) make interrupted/parallel
 * recovery safe. Data URIs and temporary provider URLs never enter the database. */
export async function archiveSeedreamResult(db: Client, owner: string, task: string, endpoint: string, raw: unknown): Promise<SeedreamResult> {
  const result = raw as SeedreamResult;
  const layerize = endpoint.endsWith('/layerize');
  if (!Array.isArray(result?.images) || !result.images.length || result.images.length > (layerize ? SEEDREAM_MAX_LAYER_IMAGES : SEEDREAM_MAX_IMAGES) ||
      result.images.some(image => typeof image?.url !== 'string' || !image.url) ||
      (!layerize && result.layers != null) || layerize && (!Array.isArray(result.layers) || result.layers.length !== result.images.length ||
        result.layers.some((layer, i, layers) => typeof layer?.image?.url !== 'string' || !layer.image.url ||
          !Number.isInteger(layer.z_index) || layer.z_index >= SEEDREAM_MAX_LAYER_IMAGES ||
          (i === 0 ? layer.z_index !== 0 : layer.z_index <= layers[i - 1].z_index)))) {
    throw new SeedreamArchiveRejected('Seedream returned an incomplete result.');
  }
  const row = await readGeneration(db, owner, task, endpoint);
  if (!row) return discardDeletedTask(db,owner,task);
  if (row.status === 'completed') {
    const saved = await readArchivedSeedreamResult(db,owner,task,endpoint);
    if (saved) return saved;
    throw new Error('Could not read the completed Seedream result manifest.');
  }
  const bucket = db.storage.from('media');
  const prefix = prefixFor(owner, task);
  const paths: string[] = [];
  let originalSize: string | undefined;
  const archive = async (image: SeedreamImage, i: number) => {
    // The flattened image list has the same order as the layers; the URLs
    // need not be string-identical (e.g. different signed query parameters).
    const bytes = await imageBytes(result.layers?.[i]?.image.url ?? image.url);
    const png = bytes.length >= 45 && bytes.subarray(0, 8).toString('hex') === '89504e470d0a1a0a'
      && bytes.readUInt32BE(8) === 13 && bytes.toString('ascii',12,16) === 'IHDR'
      && bytes.subarray(-12).toString('hex') === '0000000049454e44ae426082';
    const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes.at(-2) === 0xff && bytes.at(-1) === 0xd9;
    const size = readImageDimensions(bytes);
    if ((!png && !jpeg) || !size || (layerize && i > 0 && !png)) throw new SeedreamArchiveRejected('Seedream did not return the expected raster image.');
    const path = `${prefix}${i}.${png ? 'png' : 'jpg'}`;
    const { error } = await bucket.upload(path, bytes, { contentType: png ? 'image/png' : 'image/jpeg', upsert: true });
    if (error) throw new Error('Could not archive a Seedream image. Reconnect to the saved task to retry.');
    paths[i] = path;
    if (i === 0) originalSize = size;
  };
  for (let i = 0; i < result.images.length; i += 4) {
    await Promise.all(result.images.slice(i, i + 4).map((image, j) => archive(image, i + j)));
  }
  const signed = await signResult(db, paths, result);
  {
    const durable = withUrls(result, signed.images.map(image => canonicalMediaUrl(image.url)));
    if (durable.images.some(image => !image.url.includes('/object/authenticated/media/') || image.url.includes('?'))) {
      throw new Error('Could not create durable private references for the Seedream result.');
    }
    const [width, height] = originalSize!.split('x').map(Number);
    const actual = process.env.FAL_ADMIN_KEY ? (await fetchFalRequestCosts([task],process.env.FAL_ADMIN_KEY,{endpointIds:[endpoint]}).catch(()=>null))?.get(task) : undefined;
    const cost = actual ?? estimateSeedreamCost(row.metadata?.seedreamOptions, row.metadata?.seedreamInputCount ?? row.reference_images?.length ?? 0,
      result.images.length, { width, height });
    const completedAt = Date.now();
    const { data: updated, error } = await db.from('generations').update({
      status: 'completed', storage_path: paths[0], url: durable.images[0].url,
      metadata: { ...row.metadata, error: null, seedreamResult: durable, imageOutputSize: originalSize, falEndpoint:endpoint, falRequestId:task,
        ...(cost != null && (actual != null || row.metadata?.generationCost?.source !== 'provider_actual')
          ? { generationCost: { usd: cost, source: actual != null ? 'provider_actual' : 'published_estimate' } } : {}),
        generationStartedAt: row.metadata?.generationStartedAt ?? row.created_at, generationCompletedAt: completedAt },
    }).eq('id', row.id).eq('user_id', owner).eq('task_id', task).eq('image_model','seedream-5.5').eq('metadata->>falEndpoint',endpoint).neq('status', 'completed').select('id').maybeSingle();
    if (error) throw new Error('Could not save the Seedream result manifest. Reconnect to the saved task to retry.');
    if (!updated) {
      // Concurrent completion is successful only if we can return the winner's
      // persisted manifest. Do not delete its deterministic storage keys.
      const winner = await readArchivedSeedreamResult(db,owner,task,endpoint);
      if (winner) return winner;
      return discardDeletedTask(db,owner,task,paths);
    }
    const { error: usageError } = await db.from('usage_logs').insert({ user_id: owner, action: 'generate', model: 'seedream-5.5', prompt: String(row.prompt || '').slice(0,500), image_count: paths.length, estimated_cost: cost });
    if (usageError) console.warn('Seedream usage could not be recorded.');
  }
  return signed;
}
