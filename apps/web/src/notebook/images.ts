import sizes from './img/sizes.json';

/**
 * The notebook's pictures (D113), made by `pnpm notebook:images` from the
 * progress captures listed in images.json: the URL of each and its size,
 * so the page keeps their place before they arrive.
 */
export type ImageId = keyof typeof sizes;

const urls = import.meta.glob<string>('./img/*.webp', {
  eager: true,
  query: '?url',
  import: 'default',
});

export function picture(id: ImageId): { src: string; width: number; height: number } {
  const src = urls[`./img/cuaderno-${id}.webp`];
  if (src === undefined) throw new Error(`No picture ${id}: run pnpm notebook:images`);
  return { src, ...sizes[id] };
}
