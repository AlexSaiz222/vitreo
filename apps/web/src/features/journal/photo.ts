import { hasJpegMetadata, PHOTO_LONG_EDGE, stripJpegMetadata } from '@vitreo/shared';

/**
 * A photo from the camera or the gallery, ready to send (A8, D93): turned
 * the right way up, resized to 1600 px on its long edge and re-encoded as a
 * JPEG of about 300 KB. Re-encoding through a canvas keeps only the pixels:
 * the EXIF block (GPS included) is gone. Whatever the browser adds itself
 * (Chrome writes an sRGB colour profile) is stripped too, and the result is
 * checked before anything leaves the phone.
 */
export const PHOTO_TARGET_BYTES = 320_000;
const QUALITIES = [0.82, 0.74, 0.66, 0.58, 0.5];

export class PhotoError extends Error {}

/** The size it will be sent at: the long edge at most PHOTO_LONG_EDGE. */
export function fitSize(width: number, height: number): { width: number; height: number } {
  const scale = Math.min(1, PHOTO_LONG_EDGE / Math.max(width, height));
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

export async function preparePhoto(
  file: Blob,
): Promise<{ blob: Blob; width: number; height: number }> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new PhotoError('Esa imagen no se puede abrir.');
  }
  const { width, height } = fitSize(bitmap.width, bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new PhotoError('Este navegador no puede preparar la foto.');
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  let blob: Blob | null = null;
  for (const quality of QUALITIES) {
    blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, 'image/jpeg', quality);
    });
    if (blob && blob.size <= PHOTO_TARGET_BYTES) break;
  }
  if (!blob) throw new PhotoError('Este navegador no puede preparar la foto.');
  // Only the image goes: every metadata segment is dropped, then checked.
  let clean: Uint8Array;
  try {
    clean = stripJpegMetadata(new Uint8Array(await blob.arrayBuffer()));
  } catch {
    throw new PhotoError('Este navegador no puede preparar la foto.');
  }
  if (hasJpegMetadata(clean)) throw new PhotoError('La foto aún lleva metadatos: no se envía.');
  return {
    blob: new Blob([clean as Uint8Array<ArrayBuffer>], { type: 'image/jpeg' }),
    width,
    height,
  };
}
