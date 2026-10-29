// Cloud providers run two jobs at once; a local GPU server gets one, so jobs don't compete for VRAM.
const LOCAL_IMAGE_PROVIDERS=new Set(['sdwebui','comfyui']);
export const isLocalImageJob = job => LOCAL_IMAGE_PROVIDERS.has(job?.payload?.provider);
export const selectJobs = (pending, active, now=Date.now(), limit=2) => {
  const picked=[];let localBusy=[...active.values()].some(isLocalImageJob);
  for(const job of pending){
    if(active.size+picked.length>=limit)break;
    if(active.has(job.id)||job.retryAt>now)continue;
    if(isLocalImageJob(job)){if(localBusy)continue;localBusy=true;}
    picked.push(job);
  }
  return picked;
};
