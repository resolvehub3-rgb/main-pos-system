/**
 * Client-side image handling for pictures the app stores as data-URLs.
 *
 * The app keeps images in the row itself (product `image_url`, shop
 * `logo_url`) rather than in Supabase Storage, because the POS is local-first:
 * a photo that lives in the row is readable offline, mirrors with the row it
 * belongs to, and rides the same realtime payload as every other column — no
 * bucket, no signed URL, no second fetch on the customer screen.
 *
 * That only stays sane if the bytes stay small, so every upload is read, then
 * downscaled and re-encoded to JPEG before it is ever written. A 4 MB phone
 * photo becomes a few tens of kilobytes, which is what makes it safe to send
 * over a `postgres_changes` payload to every open till.
 */

/** Refuse anything heavier than this before doing any work on it. */
export const MAX_IMAGE_SIZE_MB = 5;

/** Read a picked file as a data-URL. */
export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Could not read this file.'));
    reader.readAsDataURL(file);
  });
}

/** Reject anything that is not an image, with a message fit for the form. */
export function assertImageFile(file: File): string | null {
  if (!file.type.startsWith('image/')) {
    return 'Please choose a valid image file (JPG, PNG or WebP).';
  }
  if (file.size > MAX_IMAGE_SIZE_MB * 1024 * 1024) {
    return `Image must be smaller than ${MAX_IMAGE_SIZE_MB} MB.`;
  }
  return null;
}

/**
 * Downscale to `maxDimension` and re-encode as JPEG so the stored value is
 * small enough to mirror and broadcast.
 *
 * Never rejects for a rendering problem — a source the browser cannot decode
 * falls back to the original data-URL, which is what the caller's
 * `.catch(() => raw)` also guards against. Resolves with the original input if
 * a 2-D context cannot be obtained.
 */
export function compressImage(
  dataUrl: string,
  options: { maxDimension?: number; quality?: number } = {}
): Promise<string> {
  const { maxDimension = 480, quality = 0.75 } = options;
  return new Promise((resolve, reject) => {
    const img = document.createElement('img');
    img.onload = () => {
      const scale = Math.min(1, maxDimension / Math.max(img.width, img.height));
      const width = Math.max(1, Math.round(img.width * scale));
      const height = Math.max(1, Math.round(img.height * scale));

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(dataUrl);
        return;
      }
      ctx.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => reject(new Error('Could not read this image file.'));
    img.src = dataUrl;
  });
}
