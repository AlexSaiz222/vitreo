import { useFrame } from '@react-three/fiber';
import { useRef, useState } from 'react';
import { Color } from 'three';
import type { MeshLambertMaterial, MeshPhysicalMaterial } from 'three';

import { useSelection } from '../app/selection.ts';
import { sceneReading } from '../data/sceneReading.ts';
import { soilColor } from './soil.ts';
import { wiltAmount } from './wilt.ts';
import type { ZoneLayout } from './zones.ts';

/** docs/02: after watering the soil darkens over 2–3 s. */
const SOIL_EASE_SECONDS = 0.8;
/** Dry soil is matt; wet soil is darker and a little glossy. */
const SOIL_ROUGHNESS = { dry: 1, wet: 0.3 } as const;
/** While a plant's sheet is open, the other pots fade back a little. */
/**
 * While a plant's sheet is open, the other pots fade towards the background
 * and the chosen one gets a little warm light (D68). At night the scene is
 * already dark, so the others fade further and the warmth shows more.
 */
const SELECTION = {
  day: { dim: 0.45, glow: 0.06 },
  night: { dim: 0.68, glow: 0.16 },
} as const;
const DIM_EASE_SECONDS = 0.25;

export type PotPalette = Record<
  | 'leafLight'
  | 'leafMid'
  | 'leafNew'
  | 'leafDeep'
  | 'flowerWhite'
  | 'flowerHeart'
  | 'fruit'
  | 'fruitGreen'
  | 'flowerChives'
  | 'stake'
  | 'terracotta'
  | 'soilDry'
  | 'soilWet'
  | 'nightGlow'
  | 'bg',
  Color
>;

/** The materials a pot shows this frame (null until mounted). */
export interface PotMaterials {
  soil: MeshPhysicalMaterial | null | undefined;
  /** Materials that fade with the selection, with their colour when not faded. */
  faded: readonly (readonly [MeshLambertMaterial | null | undefined, Color])[];
}

/**
 * Fades a material towards the background: less of its own colour, a little
 * of the background added as emission. Works on vertex-coloured materials too.
 */
function fade(
  material: MeshLambertMaterial | MeshPhysicalMaterial,
  color: Color,
  bg: Color,
  amount: number,
  glow: Color,
  warmth: number,
) {
  material.color.copy(color).multiplyScalar(1 - amount);
  material.emissive.setRGB(
    bg.r * amount + glow.r * warmth,
    bg.g * amount + glow.g * warmth,
    bg.b * amount + glow.b * warmth,
  );
}

/**
 * What every pot shows from the store, eased frame by frame: the soil colour
 * and sheen from its moisture, how wilted the plant is, and the fade while
 * another plant's sheet is open. The plant says where its materials are
 * (read every frame, so they can come from refs) and applies `wilt` its way.
 *
 * Returns the colour the soil material should start with (later changes are
 * eased here, never re-applied by React).
 */
export function usePotLook(
  zone: ZoneLayout,
  palette: PotPalette,
  {
    materials,
    onWilt,
    night,
  }: {
    materials: () => PotMaterials;
    onWilt: (amount: number) => void;
    /** The scene's theme: the selection signal is stronger at night. */
    night: boolean;
  },
): Color {
  const selected = useSelection((state) => state.zoneId);
  const dimmed = selected !== null && selected !== zone.id;
  const chosen = selected === zone.id;
  const target = useRef(new Color());
  const [initialSoil] = useState(() =>
    soilColor(palette.soilDry, palette.soilWet, sceneReading.soil(zone.id)),
  );
  const easedSoil = useRef(initialSoil.clone());
  const wilt = useRef(0);
  const dim = useRef(0);
  const warm = useRef(0);

  // Colour fades are allowed with reduced motion: they carry information.
  useFrame((_, delta) => {
    // Read every frame, live or rewound (A5): no React render per change.
    const moisture = sceneReading.soil(zone.id);
    const blend = 1 - Math.exp(-delta / SOIL_EASE_SECONDS);
    const ease = 1 - Math.exp(-delta / DIM_EASE_SECONDS);
    dim.current += ((dimmed ? 1 : 0) - dim.current) * ease;
    warm.current += ((chosen ? 1 : 0) - warm.current) * ease;
    const strength = night ? SELECTION.night : SELECTION.day;
    const fading = dim.current * strength.dim;
    const warmth = warm.current * strength.glow;
    const { soil, faded } = materials();
    for (const [material, color] of faded) {
      if (material) fade(material, color, palette.bg, fading, palette.nightGlow, warmth);
    }
    if (soil) {
      soilColor(palette.soilDry, palette.soilWet, moisture, target.current);
      easedSoil.current.lerp(target.current, blend);
      fade(soil, easedSoil.current, palette.bg, fading, palette.nightGlow, warmth);
      const wetness = moisture ?? 0;
      const roughness = SOIL_ROUGHNESS.dry + (SOIL_ROUGHNESS.wet - SOIL_ROUGHNESS.dry) * wetness;
      soil.roughness += (roughness - soil.roughness) * blend;
      soil.clearcoat += (wetness * 0.6 - soil.clearcoat) * blend;
    }
    wilt.current += (wiltAmount(moisture, zone.threshold) - wilt.current) * blend;
    onWilt(wilt.current);
  });

  return initialSoil;
}
