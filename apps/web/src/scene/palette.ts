import { useMemo } from 'react';
import { Color } from 'three';

const TOKENS = {
  bg: '--bg',
  frame: '--scene-frame',
  plinth: '--scene-plinth',
  tray: '--scene-tray',
  path: '--scene-path',
  glass: '--scene-glass',
  terracotta: '--scene-terracotta',
  terracottaShade: '--scene-terracotta-shade',
  soilDry: '--scene-soil-dry',
  soilWet: '--scene-soil-wet',
  leafLight: '--scene-leaf-light',
  leafMid: '--scene-leaf-mid',
  leafDeep: '--scene-leaf-deep',
  flowerPink: '--scene-flower-pink',
  flowerCream: '--scene-flower-cream',
  leafNew: '--scene-leaf-new',
  flowerWhite: '--scene-flower-white',
  flowerHeart: '--scene-flower-heart',
  fruit: '--scene-fruit',
  fruitGreen: '--scene-fruit-green',
  flowerChives: '--scene-flower-chives',
  stake: '--scene-stake',
  device: '--scene-device',
  deviceDark: '--scene-device-dark',
  fanBack: '--scene-fan-back',
  fanBlade: '--scene-fan-blade',
  hardware: '--scene-hardware',
  gasket: '--scene-gasket',
  water: '--scene-water',
  led: '--scene-led',
  lightStrip: '--scene-light-strip',
  decor: '--scene-decor',
  nightGlow: '--scene-night-glow',
  sun: '--scene-sun',
  moon: '--scene-moon',
  shadow: '--scene-shadow',
  sky: '--scene-sky',
  dayBg: '--scene-day-bg',
  nightBg: '--scene-night-bg',
  duskBg: '--scene-dusk-bg',
  dust: '--scene-dust',
  firefly: '--scene-firefly',
  condensation: '--scene-condensation',
  rain: '--scene-rain',
  rainStreak: '--scene-rain-streak',
  snow: '--scene-snow',
  fog: '--fog-veil',
  overcast: '--scene-overcast',
} as const;

export type ScenePalette = Record<keyof typeof TOKENS, Color>;

/** Scene colours, read from tokens.css so there is a single source of truth. */
export function useScenePalette(theme: string): ScenePalette {
  return useMemo(() => {
    const style = getComputedStyle(document.documentElement);
    const entries = Object.entries(TOKENS).map(([name, token]) => {
      const value = style.getPropertyValue(token).trim();
      if (!value) throw new Error(`Missing design token ${token} (tokens.css)`);
      return [name, new Color(value)];
    });
    return Object.fromEntries(entries) as ScenePalette;
    // The theme changes `--bg`; re-read when it does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme]);
}
