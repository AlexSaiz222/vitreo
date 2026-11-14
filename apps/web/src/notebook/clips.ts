import type { ImageId } from './images.ts';

/**
 * The notebook's clips (D133): short silent loops of the demo, made by
 * `pnpm notebook:shots` into ./clips/<id>.mp4, each with its first frame as
 * a picture (`clip-<id>` in images.json) that stands in until it plays, and
 * instead of it with reduced motion.
 */
export const CLIP_IDS = [
  'escena',
  'riego',
  'aire',
  'luz',
  'lluvia',
  'rebobinar',
  'dia-en-un-minuto',
] as const;

export type ClipId = (typeof CLIP_IDS)[number];

const urls = import.meta.glob<string>('./clips/*.mp4', {
  eager: true,
  query: '?url',
  import: 'default',
});

export function clip(id: ClipId): { src: string; poster: ImageId } {
  const src = urls[`./clips/${id}.mp4`];
  if (src === undefined) throw new Error(`No clip ${id}: run pnpm notebook:shots`);
  return { src, poster: `clip-${id}` as ImageId };
}
