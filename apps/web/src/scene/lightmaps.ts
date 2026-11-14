import { useFrame, useLoader } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import { FileLoader, SRGBColorSpace, TextureLoader, Vector3 } from 'three';
import type { Color, Texture, WebGLProgramParametersWithUniforms } from 'three';
import { z } from 'zod';

import { now as nowMs } from '../app/clock.ts';
import { IN_DEMO } from '../app/demo.ts';
import { nightAmount } from '../app/dayNight.ts';
import { currentLocation } from '../app/location.ts';
import { useReplay } from '../data/replay.ts';
import { useThemeSetting } from '../app/themeChoice.ts';
import { overcastLight, sceneWeather } from './atmosphere.ts';
import { useReducedMotion } from './useReducedMotion.ts';
import type { ThemeMode } from './useTheme.ts';

/** Written by `pnpm models` next to the model (docs/04, part 5). */
export const LIGHTMAPS_URL = '/models/lightmaps.json';

const atlas = z.object({
  file: z.string(),
  intensity: z.number().positive(),
  /** The colour of the atlas's light at luminance 1, measured by `pnpm models` (day only, D134). */
  tint: z.tuple([z.number().positive(), z.number().positive(), z.number().positive()]).optional(),
});
const rgb = z.tuple([z.number(), z.number(), z.number()]);
/** Light from +x, -x, +y, -y, +z, -z. */
const cube = z.tuple([rgb, rgb, rgb, rgb, rgb, rgb]);
const probe = z.object({ day: cube, night: cube, lamp: cube });
const schema = z.object({
  objects: z.array(z.string()),
  atlases: z.object({ day: atlas, night: atlas, lamp: atlas }),
  /** Baked light around each part that is not baked (D68), by node name. */
  probes: z.record(z.string(), probe).default({}),
});

/**
 * Linear light around a part, per atlas (intensity applied, not the
 * exposure), as an ambient cube: what arrives from +x, -x, +y, -y, +z, -z.
 */
export interface LightProbe {
  day: Vector3[];
  night: Vector3[];
  lamp: Vector3[];
}

/**
 * The Blender renders use an exposure of −0.45 (build_greenhouse.py, preview
 * settings); the lightmaps store the light before it. Applied here so the
 * app looks like the render.
 */
const EXPOSURE = 2 ** -0.45;
/** Day ↔ night follows the sun slowly; a forced theme change fades in this. */
const NIGHT_EASE_SECONDS = 1.2;
/** The grow light's baked light fades in and out with the switch. */
const LAMP_EASE_SECONDS = 0.3;
/** Every second in the demo, whose day can last a minute (D112). */
const NIGHT_CHECK_MS = IN_DEMO ? 1000 : 60_000;
/**
 * The night fill: linear light added to what the night atlas leaves dark
 * (the outside of the frame sees only the moon), halfway between the moon
 * and the warm light inside. Enough to read as dusk, not as black.
 */
const NIGHT_FILL = { strength: 0.05, warmth: 0.5 } as const;

/**
 * The day's grade (D134), what a camera does to a warm afternoon: the baked
 * sun and its bounce off the sand tint everything peach, so white profiles
 * never looked white.
 * - `balance`: how much of the light's measured tint is taken out (the rest
 *   stays: a little warmth is the afternoon).
 * - `contrast` around `pivot`: shade and the occlusion in corners read
 *   deeper, sunlit faces brighter.
 * - `knee` … `ceiling`: a soft shoulder, so a sunlit face shows its token's
 *   colour and never clips.
 * - `shadeWarmth`: the tint goes back into the shade (--scene-shadow), so
 *   shadows stay warm, never grey (docs/02).
 */
const DAY_GRADE = {
  balance: 0.88,
  contrast: 1.22,
  pivot: 0.5,
  knee: 0.78,
  ceiling: 1.04,
  shadeWarmth: 0.3,
} as const;

export interface LightmapUniforms {
  uLightNight: { value: Texture | null };
  uLightLamp: { value: Texture | null };
  /** Linear light per decoded texel, for day, night and lamp (with the exposure). */
  uLightScale: { value: Vector3 };
  /** 0 day … 1 night. */
  uNightMix: { value: number };
  /** 0 off … 1 on. */
  uLampOn: { value: number };
  /** The render's exposure (for the light probes, whose light is already scaled). */
  uExposure: { value: number };
  /** A soft fill at night, so nothing goes black (docs/02); × uNightMix. */
  uNightFill: { value: Vector3 };
  /**
   * Clouds (A10): 0 the baked sun as rendered … 1 the soft light of a grey
   * day (shadows lifted, highlights lowered, a little less colour).
   */
  uOvercast: { value: number };
  /** What the day's light is multiplied by to take its tint out (D134). */
  uDayBalance: { value: Vector3 };
  /** The colour shade leans to, at luminance 1 (--scene-shadow). */
  uShadeTint: { value: Vector3 };
}

export interface Lightmaps {
  /** The day atlas: set as the material's `lightMap`, so three provides the UV. */
  day: Texture;
  uniforms: { readonly current: LightmapUniforms };
  /** Light probes for the parts that are not baked, by node name (D68). */
  probes: ReadonlyMap<string, LightProbe>;
}

/**
 * Anisotropic filtering for the lightmaps. Islands in the atlas are 19 px
 * apart (16 px margin, extended, at 2048 px), so mipmaps only start to mix
 * neighbours from level 3 (8× minification), which the camera never needs;
 * but grazing surfaces (the floor at 23°) pick coarser levels. Anisotropy
 * keeps them on finer ones. Mipmaps stay: without them the baked shadows
 * would shimmer when orbiting. three caps it at what the device allows.
 */
const LIGHTMAP_ANISOTROPY = 4;

/** A lightmap texture as glTF UVs expect it: not flipped, sRGB, first UV set. */
function asLightmap(source: Texture): Texture {
  const texture = source.clone();
  texture.flipY = false;
  texture.colorSpace = SRGBColorSpace;
  texture.channel = 0;
  texture.anisotropy = LIGHTMAP_ANISOTROPY;
  texture.needsUpdate = true;
  return texture;
}

/** How much of the night lighting to show: the real sun, or the forced setting. */
function useNightTarget(theme: ThemeMode): number {
  const setting = useThemeSetting((state) => state.setting);
  const forced = setting !== 'auto';
  const [now, setNow] = useState(() => new Date(nowMs()));
  useEffect(() => {
    if (forced) return;
    const timer = setInterval(() => {
      setNow(new Date(nowMs()));
    }, NIGHT_CHECK_MS);
    return () => {
      clearInterval(timer);
    };
  }, [forced]);
  // Rewound (A5): the light of that instant, in small steps so scrubbing
  // re-renders only when the light really changes.
  const past = useReplay((state) =>
    state.mode === 'replay'
      ? Math.round(nightAmount(new Date(state.at * 1000), currentLocation()) * 20) / 20
      : null,
  );
  if (forced) return theme === 'night' ? 1 : 0;
  return past ?? nightAmount(now, currentLocation());
}

/**
 * The baked light of the diorama (docs/04, part 5): three atlases from
 * Blender, mixed every frame — day ↔ night through twilight (suncalc) plus
 * the grow light when it is on. Suspends until they are loaded.
 */
export function useLightmaps(
  theme: ThemeMode,
  growLight: boolean,
  /** Palette colours of the night fill (--scene-moon, --scene-night-glow). */
  fill: { moon: Color; glow: Color; shadow: Color },
): Lightmaps {
  const json = useLoader(FileLoader, LIGHTMAPS_URL);
  const meta = useMemo(() => schema.parse(JSON.parse(String(json))), [json]);
  const urls = [meta.atlases.day, meta.atlases.night, meta.atlases.lamp].map(
    ({ file }) => `/models/${file}`,
  );
  const loaded = useLoader(TextureLoader, urls);
  const [day, night, lamp] = useMemo(() => loaded.map(asLightmap), [loaded]);
  useEffect(
    () => () => {
      for (const texture of [day, night, lamp]) texture?.dispose();
    },
    [day, night, lamp],
  );
  const nightTarget = useNightTarget(theme);
  const reducedMotion = useReducedMotion();
  const uniforms = useRef<LightmapUniforms>({
    uLightNight: { value: null },
    uLightLamp: { value: null },
    uLightScale: { value: new Vector3() },
    uNightMix: { value: nightTarget },
    uLampOn: { value: growLight ? 1 : 0 },
    uExposure: { value: EXPOSURE },
    uNightFill: { value: new Vector3() },
    uOvercast: { value: 0 },
    uDayBalance: { value: new Vector3(1, 1, 1) },
    uShadeTint: { value: new Vector3(1, 1, 1) },
  });
  const probes = useMemo(
    () =>
      new Map(
        Object.entries(meta.probes).map(([name, { day: d, night: n, lamp: l }]) => {
          const vectors = (cube: readonly (readonly [number, number, number])[]) =>
            cube.map((light) => new Vector3(...light));
          return [name, { day: vectors(d), night: vectors(n), lamp: vectors(l) }];
        }),
      ),
    [meta],
  );

  // Runs before each render, so the uniforms are set before the first compile.
  useFrame((_, delta) => {
    const u = uniforms.current;
    u.uLightNight.value = night ?? null;
    u.uLightLamp.value = lamp ?? null;
    u.uNightFill.value
      .set(fill.moon.r, fill.moon.g, fill.moon.b)
      .lerp(new Vector3(fill.glow.r, fill.glow.g, fill.glow.b), NIGHT_FILL.warmth)
      .multiplyScalar(NIGHT_FILL.strength);
    u.uLightScale.value.set(
      meta.atlases.day.intensity * EXPOSURE,
      meta.atlases.night.intensity * EXPOSURE,
      meta.atlases.lamp.intensity * EXPOSURE,
    );
    const tint = meta.atlases.day.tint ?? [1, 1, 1];
    u.uDayBalance.value
      .set(1 / tint[0], 1 / tint[1], 1 / tint[2])
      .lerp(WHITE, 1 - DAY_GRADE.balance);
    const shade = fill.shadow;
    const shadeLuminance = 0.2126 * shade.r + 0.7152 * shade.g + 0.0722 * shade.b || 1;
    u.uShadeTint.value.set(shade.r, shade.g, shade.b).divideScalar(shadeLuminance);
    // Light changes carry information: they fade even with reduced motion,
    // but the theme jumps at once with it (as the interface does).
    const nightBlend = reducedMotion ? 1 : 1 - Math.exp(-delta / NIGHT_EASE_SECONDS);
    u.uNightMix.value += (nightTarget - u.uNightMix.value) * nightBlend;
    u.uLampOn.value +=
      ((growLight ? 1 : 0) - u.uLampOn.value) * (1 - Math.exp(-delta / LAMP_EASE_SECONDS));
    // Already eased by the atmosphere (A10).
    u.uOvercast.value = overcastLight(sceneWeather.clouds).flatten;
  });

  if (!day) throw new Error('No day lightmap');
  return { day, uniforms, probes };
}

const WHITE = new Vector3(1, 1, 1);

/** The day's grade (DAY_GRADE). Linear light with the exposure in, out. */
const DAY_GRADE_GLSL = /* glsl */ `
  uniform vec3 uDayBalance;
  uniform vec3 uShadeTint;
  vec3 dayGrade( vec3 light ) {
    light *= uDayBalance;
    float lum = dot( light, vec3( 0.2126, 0.7152, 0.0722 ) );
    float curved = ${DAY_GRADE.pivot.toFixed(3)} * pow( lum / ${DAY_GRADE.pivot.toFixed(3)}, ${DAY_GRADE.contrast.toFixed(3)} );
    float room = ${(DAY_GRADE.ceiling - DAY_GRADE.knee).toFixed(3)};
    float graded = curved < ${DAY_GRADE.knee.toFixed(3)}
      ? curved
      : ${DAY_GRADE.knee.toFixed(3)} + room * ( 1.0 - exp( - ( curved - ${DAY_GRADE.knee.toFixed(3)} ) / room ) );
    float shade = 1.0 - smoothstep( 0.2, 0.75, lum );
    return light * ( graded / max( lum, 1e-4 ) )
      * mix( vec3( 1.0 ), uShadeTint, shade * ${DAY_GRADE.shadeWarmth.toFixed(3)} );
  }
`;

/**
 * The day's baked light under clouds (A10): contrast compressed (shadows
 * lifted, highlights lowered), a little less colour. Linear light in, out.
 */
const OVERCAST_GLSL = /* glsl */ `
  vec3 overcast( vec3 light, float amount ) {
    vec3 soft = pow( max( light, vec3( 0.0 ) ), vec3( 0.6 ) ) * 0.78;
    float grey = dot( soft, vec3( 0.299, 0.587, 0.114 ) );
    return mix( light, mix( soft, vec3( grey ), 0.3 ), amount );
  }
`;

/**
 * Lights a material only with the baked light: its colour (token, vertex
 * colour, selection fade…) times the lightmaps; dynamic lights and shadows
 * no longer add to it, so nothing is lit twice. Emission still adds on top.
 * Specular highlights are kept (the wet soil's sheen is data). The material
 * needs `lightMap` set (the day atlas), which gives the shader its UV.
 */
export function bakedLight(uniforms: { readonly current: LightmapUniforms }) {
  return (shader: WebGLProgramParametersWithUniforms) => {
    Object.assign(shader.uniforms, uniforms.current);
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform sampler2D uLightNight;
        uniform sampler2D uLightLamp;
        uniform vec3 uLightScale;
        uniform float uNightMix;
        uniform float uLampOn;
        uniform vec3 uNightFill;
        uniform float uOvercast;
        ${DAY_GRADE_GLSL}
        ${OVERCAST_GLSL}`,
      )
      .replace(
        '#include <lights_fragment_end>',
        `#include <lights_fragment_end>
        #ifdef USE_LIGHTMAP
          vec3 bakedLight = uNightFill * uNightMix +
            overcast( dayGrade( texture2D( lightMap, vLightMapUv ).rgb * uLightScale.x ), uOvercast ) * ( 1.0 - uNightMix )
            + texture2D( uLightNight, vLightMapUv ).rgb * uLightScale.y * uNightMix
            + texture2D( uLightLamp, vLightMapUv ).rgb * uLightScale.z * uLampOn;
          reflectedLight.directDiffuse = vec3( 0.0 );
          reflectedLight.indirectDiffuse = diffuseColor.rgb * bakedLight;
        #endif`,
      );
  };
}

/**
 * Lights a part that is not baked like its baked neighbours (D68): its
 * colour times the light probe around it (an ambient cube: brighter on the
 * sides that face the light), with the same day ↔ night and lamp mix as the
 * lightmaps; no dynamic lights, so nothing is lit twice and
 * a door or a vent matches the frame next to it. Emission still adds.
 */
export function probeLight(uniforms: { readonly current: LightmapUniforms }, probe: LightProbe) {
  return (shader: WebGLProgramParametersWithUniforms) => {
    Object.assign(shader.uniforms, uniforms.current, {
      uCubeDay: { value: probe.day },
      uCubeNight: { value: probe.night },
      uCubeLamp: { value: probe.lamp },
    });
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform vec3 uCubeDay[6];
        uniform vec3 uCubeNight[6];
        uniform vec3 uCubeLamp[6];
        // The light an ambient cube sends along a normal (squared weights).
        vec3 ambientCube( vec3 c[6], vec3 n ) {
          vec3 n2 = n * n;
          return n2.x * ( n.x >= 0.0 ? c[0] : c[1] )
            + n2.y * ( n.y >= 0.0 ? c[2] : c[3] )
            + n2.z * ( n.z >= 0.0 ? c[4] : c[5] );
        }
        uniform float uNightMix;
        uniform float uLampOn;
        uniform float uExposure;
        uniform vec3 uNightFill;
        uniform float uOvercast;
        ${DAY_GRADE_GLSL}
        ${OVERCAST_GLSL}`,
      )
      .replace(
        '#include <lights_fragment_end>',
        `#include <lights_fragment_end>
        vec3 probeNormal = inverseTransformDirection( normal, viewMatrix );
        vec3 probeLight = (
          mix( overcast( dayGrade( ambientCube( uCubeDay, probeNormal ) * uExposure ), uOvercast ) / uExposure, ambientCube( uCubeNight, probeNormal ), uNightMix )
          + ambientCube( uCubeLamp, probeNormal ) * uLampOn
        ) * uExposure + uNightFill * uNightMix;
        reflectedLight.directDiffuse = vec3( 0.0 );
        reflectedLight.indirectDiffuse = diffuseColor.rgb * probeLight;`,
      );
  };
}
