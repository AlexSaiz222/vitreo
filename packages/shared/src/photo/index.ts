/**
 * Photos without metadata (A8, D93). A JPEG keeps its image and loses every
 * metadata segment: APP1–APP15 (EXIF with GPS, XMP, ICC…) and comments.
 * The phone checks its own output with it before sending; the hub strips
 * again, whatever a client sends. No location ever leaves the phone.
 */
export class JpegError extends Error {}

const u16 = (bytes: Uint8Array, at: number) => ((bytes[at] ?? 0) << 8) | (bytes[at + 1] ?? 0);

/** The JPEG without metadata; throws JpegError if it is not a well-formed JPEG. */
export function stripJpegMetadata(bytes: Uint8Array): Uint8Array {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    throw new JpegError('not a JPEG');
  }
  const parts: Uint8Array[] = [bytes.subarray(0, 2)];
  let i = 2;
  while (i < bytes.length) {
    if (bytes[i] !== 0xff) throw new JpegError('broken JPEG');
    const marker = bytes[i + 1] ?? 0;
    // Start of scan (the image data follows, to the end) or end of image.
    if (marker === 0xda || marker === 0xd9) {
      parts.push(bytes.subarray(i));
      const out = new Uint8Array(parts.reduce((n, part) => n + part.length, 0));
      let at = 0;
      for (const part of parts) {
        out.set(part, at);
        at += part.length;
      }
      return out;
    }
    if (marker === 0xff) {
      i += 1;
      continue;
    }
    if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      parts.push(bytes.subarray(i, i + 2));
      i += 2;
      continue;
    }
    if (i + 4 > bytes.length) throw new JpegError('broken JPEG');
    const end = i + 2 + u16(bytes, i + 2);
    if (end <= i + 3 || end > bytes.length) throw new JpegError('broken JPEG');
    const metadata = (marker >= 0xe1 && marker <= 0xef) || marker === 0xfe;
    if (!metadata) parts.push(bytes.subarray(i, end));
    i = end;
  }
  throw new JpegError('broken JPEG');
}

/** Has this JPEG any metadata segment (EXIF, GPS, XMP…)? */
export function hasJpegMetadata(bytes: Uint8Array): boolean {
  return stripJpegMetadata(bytes).length !== bytes.length;
}
