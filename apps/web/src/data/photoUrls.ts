/** Photos still on the phone (A8), shown from memory until the hub has them. */
const urls = new WeakMap<Blob, string>();

/** A photo still on the phone, as an image URL (one per photo, reused). */
export function photoUrl(blob: Blob): string {
  let url = urls.get(blob);
  if (!url) {
    url = URL.createObjectURL(blob);
    urls.set(blob, url);
  }
  return url;
}

/** The photo is no longer shown from the phone (saved, or discarded). */
export function releasePhotoUrl(blob: Blob): void {
  const url = urls.get(blob);
  if (url) URL.revokeObjectURL(url);
  urls.delete(blob);
}
