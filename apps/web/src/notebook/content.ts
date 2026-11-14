import type { ReactNode } from 'react';

import { stop1 } from './stops/01-la-escena.tsx';
import { stop2 } from './stops/02-una-planta.tsx';
import { stop3 } from './stops/03-aire-y-luz.tsx';
import { stop4 } from './stops/04-el-tiempo-de-fuera.tsx';
import { stop5 } from './stops/05-la-memoria.tsx';
import { stop6 } from './stops/06-el-sonido.tsx';
import { stop7 } from './stops/07-como-se-hizo.tsx';
import type { ClipId } from './clips.ts';
import type { ImageId } from './images.ts';

/**
 * The notebook's content ("Cómo se hizo", D113, D133): a visit through the
 * demo, one stop for each thing you can do in it, and what is behind it.
 * Written in Spanish, in the first person; every number and decision comes
 * from docs/ (each decision cited exists in docs/11, by its number), never
 * invented. The pictures and clips are of the demo as it is today
 * (`pnpm notebook:shots`); the old captures only where old is the point.
 */

/** One picture with its words, for whoever cannot see it. */
export interface Shot {
  image: ImageId;
  alt: string;
  /** Its name in a comparison or a strip: "De día", "3 oct". */
  label: string;
}

export type Visual =
  /**
   * A capture across the page; `close`, a crop of it to what matters (an
   * open panel), shown instead on a phone, where the whole would not read.
   */
  | { kind: 'image'; image: ImageId; close?: ImageId; alt: string; caption: ReactNode }
  /** A short silent loop of the demo, its first frame until it plays. */
  | { kind: 'clip'; clip: ClipId; alt: string; caption: ReactNode }
  /** Two captures of the same frame, one over the other, with a handle between. */
  | { kind: 'compare'; before: Shot; after: Shot; caption: ReactNode }
  /** Phone captures side by side, all the same size. */
  | { kind: 'phones'; shots: Shot[]; caption: ReactNode }
  /** Captures in the order they were taken, in a row. */
  | { kind: 'strip'; shots: Shot[]; caption: ReactNode };

export interface Section {
  /** Anchor of the section, unique in the notebook. */
  id: string;
  title: string;
  body: ReactNode;
  visual?: Visual;
}

export interface Decision {
  /** As in docs/11: "D40". */
  id: string;
  text: ReactNode;
}

export interface Stop {
  number: number;
  /** Anchor of the stop. */
  id: string;
  title: string;
  /** What it is about, in a line. */
  subtitle: string;
  lead: ReactNode;
  /** What to try in the demo for it. */
  tryIt?: ReactNode;
  sections: Section[];
  /** The decisions behind it, by their number in docs/11. */
  decisions: Decision[];
}

export const STOPS: readonly Stop[] = [stop1, stop2, stop3, stop4, stop5, stop6, stop7];

/** Decisions recorded in docs/11 when this notebook was last written. */
export const DECISIONS_SO_FAR = 136;
