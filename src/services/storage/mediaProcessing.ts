export const createThumbnail = (dataUrl: string, maxWidth = 400, quality = 0.8): Promise<Blob> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ratio = maxWidth / img.width;
      const scale = ratio < 1 ? ratio : 1;

      canvas.width = Math.floor(img.width * scale);
      canvas.height = Math.floor(img.height * scale);

      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error("Canvas context failed"));
        return;
      }

      // Enable image smoothing for better quality downscaling
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

      // Use PNG so the filename, mime type, and storage metadata stay in sync.
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error("Thumbnail creation failed"));
      }, 'image/png', quality);
    };
    img.onerror = (e) => reject(e);
    img.src = dataUrl;
  });
};

export const createVideoThumbnail = (videoBlob: Blob, maxWidth = 640): Promise<Blob> => {
  return new Promise((resolve, reject) => {
    if (typeof document === 'undefined') {
      reject(new Error('Video thumbnail generation requires a browser'));
      return;
    }

    const objectUrl = URL.createObjectURL(videoBlob);
    const video = document.createElement('video');
    let timeoutId: number | undefined;
    let settled = false;

    const cleanup = () => {
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
      video.pause();
      video.removeAttribute('src');
      video.load();
      URL.revokeObjectURL(objectUrl);
    };
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error instanceof Error ? error : new Error('Video thumbnail generation failed'));
    };
    const capture = () => {
      if (settled) return;
      const sourceWidth = video.videoWidth;
      const sourceHeight = video.videoHeight;
      if (!sourceWidth || !sourceHeight) {
        fail(new Error('Video dimensions are unavailable'));
        return;
      }

      const scale = Math.min(1, maxWidth / sourceWidth);
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(sourceWidth * scale));
      canvas.height = Math.max(1, Math.round(sourceHeight * scale));
      const context = canvas.getContext('2d');
      if (!context) {
        fail(new Error('Canvas context failed'));
        return;
      }

      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = 'high';
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((blob) => {
        if (!blob) {
          fail(new Error('Video thumbnail encoding failed'));
          return;
        }
        if (settled) return;
        settled = true;
        cleanup();
        resolve(blob);
      }, 'image/png');
    };

    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.onloadedmetadata = () => {
      const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
      // The first few frames are often a fade from black. Capture around 10%
      // into the clip (capped at one second) so the durable gallery poster is
      // representative instead of looking like a missing thumbnail.
      const targetTime = duration > 0.2
        ? Math.min(1, Math.max(0.1, duration * 0.1))
        : 0;
      if (targetTime <= 0) {
        if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) capture();
        else video.onloadeddata = capture;
        return;
      }
      video.onseeked = capture;
      video.currentTime = targetTime;
    };
    video.onerror = () => fail(new Error('Video could not be decoded for its thumbnail'));
    timeoutId = window.setTimeout(() => fail(new Error('Video thumbnail generation timed out')), 15_000);
    video.src = objectUrl;
    video.load();
  });
};

// --- Helper: Compress Image for Reference ---
export const compressImage = (dataUrl: string, maxWidth = 1024, quality = 0.85): Promise<string> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ratio = maxWidth / img.width;
      const scale = ratio < 1 ? ratio : 1;

      canvas.width = Math.floor(img.width * scale);
      canvas.height = Math.floor(img.height * scale);

      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error("Canvas context failed"));
        return;
      }

      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

      // Return as JPEG for smaller size
      const compressedDataUrl = canvas.toDataURL('image/jpeg', quality);
      resolve(compressedDataUrl);
    };
    img.onerror = (e) => reject(e);
    img.src = dataUrl;
  });
};

// --- Helper: Estimate data URL size in bytes ---
export const estimateBase64Size = (dataUrl: string): number => {
  // Remove the data URL prefix to get just the base64 part
  const base64 = dataUrl.split(',')[1] || dataUrl;
  // Base64 encodes 3 bytes into 4 characters, so divide by 4/3
  return Math.ceil((base64.length * 3) / 4);
};
