import {
  Color,
  DataTexture,
  DoubleSide,
  LinearFilter,
  LinearMipmapLinearFilter,
  RedFormat,
  RepeatWrapping,
  RGBAFormat,
  ShaderMaterial,
  Vector3,
} from 'three';

import { dropTile, mistTile } from './dropTile.ts';

/**
 * Glass with presence but still see-through (ref-03, render v17): a faint
 * milky veil in the glass tint, stronger at grazing angles (fresnel), and a
 * soft reflection of a very simple world — the roof panes, facing up,
 * reflect the sky; the walls reflect the light page below. At night it picks
 * up a slight warm halo from inside.
 *
 * Unlit on purpose: it only adds on top of what is behind it.
 *
 * Water on the glass (D118), from the data only: mist from air.rh
 * (scene/atmosphere.ts), and drops from the rain outside or, once the mist is
 * thick, from the condensation itself.
 * - Mist: blotchy, heavier low on the panes, with a fine grain of tiny beads.
 * - Drops: from a tile made by code (dropTile.ts), each with a surface that
 *   bends the light: a fake refraction that shifts what the pane reflects
 *   (upside down, as a lens does) rather than rendering what is behind it,
 *   a dark rim and a glint of the sun or the moon.
 * - Runs: now and then a drop lets go and slides down, on a crooked path of
 *   its own that changes every time. It swallows the drops in its way, wipes
 *   a clean track through the mist and leaves small beads behind.
 * Baja draws no runs; with reduced motion everything stands still.
 */
const vertexShader = /* glsl */ `
  varying vec3 vWorldPosition;
  varying vec3 vWorldNormal;
  varying vec2 vPane;
  varying vec3 vAcross;
  varying vec3 vUp;

  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorldPosition = world.xyz;
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
    // Metres along the pane: x level, y straight up its slope, so water
    // falls down it on the walls and the roof alike.
    vec3 across = cross(vec3(0.0, 1.0, 0.0), vWorldNormal);
    across = dot(across, across) < 0.0001 ? vec3(1.0, 0.0, 0.0) : normalize(across);
    vAcross = across;
    vUp = cross(vWorldNormal, across);
    // Each direction of pane starts somewhere else in the tile.
    float shift = dot(vWorldNormal, vec3(3.1, 7.7, 5.3));
    vPane = vec2(dot(world.xyz, across) + shift, dot(world.xyz, vUp) - shift);
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const fragmentShader = /* glsl */ `
  uniform vec3 uTint;
  uniform vec3 uSky;
  uniform vec3 uPage;
  uniform vec3 uGlow;
  uniform float uVeil;
  uniform float uEdge;
  uniform float uReflection;
  uniform float uGlowAmount;
  uniform float uFog;
  uniform vec3 uFogColor;
  uniform float uFloor;
  uniform float uHeight;
  uniform float uRain;
  uniform vec3 uRainColor;
  uniform float uTime;
  uniform sampler2D uDrops;
  uniform sampler2D uMistNoise;
  uniform float uRuns;
  uniform vec3 uSunDirection;
  uniform float uSun;
  uniform float uSnow;
  uniform vec3 uSnowColor;

  varying vec3 vWorldPosition;
  varying vec3 vWorldNormal;
  varying vec2 vPane;
  varying vec3 vAcross;
  varying vec3 vUp;

  // Metres of glass one tile of drops covers.
  const float DROP_TILE = 0.3;
  // The roof, as fractions (build_greenhouse.py): the eave at EAVE / RIDGE of
  // the frame's height, and the purlin that splits each slope in two panes.
  const float ROOF_EAVE = 0.34 / 0.56;
  const float ROOF_PURLIN = 0.45;
  // And the walls: the top of the sill plate, the mid rail, and the gable's
  // tie over the eave, where each row of panes starts.
  const float WALL_SILL = 0.018 / 0.56;
  const float WALL_RAIL = 0.135 / 0.56;
  const float GABLE_TIE = 0.356 / 0.56;

  // A soft band of the given width, repeating every unit of d.
  float streak(float d, float start, float width) {
    float x = fract(d) - start;
    return smoothstep(0.0, width * 0.5, x) * (1.0 - smoothstep(width * 0.5, width, x));
  }

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }

  // Drops that let go and slide down: one column of the glass at a time,
  // each new drop on its own crooked path. All in metres.
  void runs(
    float columnWidth, float cellHeight, float speed, float radius, float amount,
    inout vec2 bend, inout float water, inout float cleared
  ) {
    float column = floor(vPane.x / columnWidth);
    float seed = hash(vec2(column, columnWidth * 97.0));
    float travel = (vPane.y + uTime * speed * (0.6 + 0.8 * seed)) / cellHeight + seed * 31.0;
    float id = hash(vec2(column, floor(travel)));
    if (id > amount) return;
    float pick = hash(vec2(id, 5.0));
    // It clings, then slips: the head wanders within its cell.
    float slip = sin(uTime * (0.9 + 1.4 * pick) + pick * 50.0) * sin(uTime * 0.53 + pick * 9.0);
    float head = 0.24 + 0.1 * slip;
    // The path is fixed on the glass: what follows the drop stays on it.
    float path = columnWidth * (0.5 + 0.5 * (pick - 0.5)
      + 0.16 * sin(vPane.y * 21.0 + pick * 40.0) + 0.07 * sin(vPane.y * 57.0 + pick * 17.0));
    float x = vPane.x - column * columnWidth - path;
    float y = (fract(travel) - head) * cellHeight;
    float size = radius * (0.72 + 0.56 * pick);

    // The head: narrow above, like a falling drop on a pane.
    vec2 d = vec2(x, y * (y > 0.0 ? 0.5 : 1.0)) / size;
    float inside = 1.0 - dot(d, d);
    if (inside > 0.0) {
      float mask = smoothstep(0.0, 0.3, inside);
      bend += d * mask;
      water = max(water, mask);
    }

    // Its track: clean glass that closes up again higher up.
    if (y > 0.0) {
      float reach = cellHeight * 0.6;
      float fade = 1.0 - smoothstep(0.0, reach, y);
      float wide = 1.0 - smoothstep(size * 0.45, size * 1.05, abs(x));
      cleared = max(cleared, wide * fade);
      // And a few small beads left behind on it.
      float beadStep = size * 2.6;
      float row = floor(vPane.y / beadStep);
      float bead = hash(vec2(row, id));
      if (bead > 0.45 && fade > 0.08) {
        vec2 b = vec2(x - (bead - 0.7) * size, vPane.y - (row + 0.5) * beadStep)
          / (size * (0.16 + 0.26 * bead));
        float small = 1.0 - dot(b, b);
        if (small > 0.0) {
          float mask = smoothstep(0.0, 0.4, small);
          bend += b * mask;
          water = max(water, mask);
        }
      }
    }
  }

  void main() {
    vec3 normal = normalize(vWorldNormal) * (gl_FrontFacing ? 1.0 : -1.0);
    vec3 view = normalize(cameraPosition - vWorldPosition);
    float fresnel = pow(1.0 - abs(dot(normal, view)), 3.0);

    // What the pane reflects: sky above the horizon, the page below.
    vec3 reflected = reflect(-view, normal);
    vec3 world = mix(uPage, uSky, smoothstep(-0.25, 0.45, reflected.y));

    // Diagonal streaks, fixed in world space so they read as one reflection
    // (spaced for the real-size greenhouse, under a metre long).
    float d = (vWorldPosition.x + vWorldPosition.z) * 2.2 + vWorldPosition.y * 3.2;
    float streaks = streak(d, 0.1, 0.07) + 0.6 * streak(d, 0.24, 0.035);

    float reflection = uReflection * (0.35 + 0.65 * fresnel);
    vec3 color = mix(uTint, world, clamp(reflection * 4.0, 0.0, 1.0));
    color = mix(color, uGlow, uGlowAmount);
    float alpha = uVeil + fresnel * uEdge + reflection + streaks * 0.025 + uGlowAmount * 0.1;

    float height = clamp((vWorldPosition.y - uFloor) / uHeight, 0.0, 1.0);

    // Seen from afar a drop is a pixel or two, and anything dark on that reads
    // as dirt: the smaller it is on screen, the paler and fainter.
    float close = smoothstep(0.0034, 0.0011, fwidth(vPane.y));

    // The drops, first: what the mist must leave clear depends on them.
    float wetness = max(uRain, 0.7 * smoothstep(0.55, 1.0, uFog));
    vec2 bend = vec2(0.0);
    float water = 0.0;
    float cleared = 0.0;
    if (wetness > 0.001) {
      vec4 tile = texture2D(uDrops, vPane / DROP_TILE);
      // Drops gather in patches, which also hides the tile's repeat.
      float patches = texture2D(uMistNoise, vPane * 1.3).r;
      float here = wetness * (0.5 + patches);
      float there = smoothstep(tile.a, tile.a + 0.12, here) * tile.b;
      water = smoothstep(0.06, 0.24, there);
      bend = (tile.rg - 0.5) * 2.0 * water;
      if (uRuns > 0.5) {
        vec2 runBend = vec2(0.0);
        float runWater = 0.0;
        runs(0.07, 0.72, 0.075, 0.0072, wetness * 0.6, runBend, runWater, cleared);
        runs(0.16, 1.2, 0.13, 0.0108, wetness * 0.5, runBend, runWater, cleared);
        // A run swallows the drops in its way.
        float kept = 1.0 - cleared;
        bend = bend * kept + runBend;
        water = max(water * kept, runWater);
      }
    }

    // Condensation: blotchy mist, heavier low on the panes, with a grain of
    // tiny beads; open wherever a drop is or has just run.
    if (uFog > 0.001) {
      float blotches = texture2D(uMistNoise, vPane * 2.1).r;
      float grain = texture2D(uDrops, vPane / DROP_TILE * 5.3 + 0.37).b;
      float open = 1.0 - max(cleared, water * 0.55 * close);
      float mist = uFog * (1.0 - 0.62 * smoothstep(0.1, 0.95, height));
      mist *= (0.55 + 0.9 * blotches) * open;
      color = mix(color, uFogColor, clamp(mist, 0.0, 1.0));
      alpha += mist * (0.42 + 0.2 * grain);
    }

    if (water > 0.001) {
      // Panes on the far side of the greenhouse, seen through the near ones,
      // stay quieter: depth, and less clutter.
      float near = gl_FrontFacing ? 1.0 : 0.55;
      float night = uGlowAmount / 0.35;
      float rim = smoothstep(0.66, 0.98, length(bend));
      // Water is clear: it barely tints what is behind it. It reads by its
      // edge, which bends the light away, and by what its surface catches.
      // A lens turns the world over: its lower half holds the sky.
      vec3 ink = mix(uRainColor, uRainColor * mix(0.6, 0.16, night), close);
      vec3 lens = mix(mix(uSky, uGlow, night * 0.5), ink, smoothstep(-0.5, 0.5, bend.y));
      float body = smoothstep(-0.2, -0.75, bend.y) * mix(0.34, 0.2, night) + 0.1;
      color = mix(color, mix(lens, ink, rim), water * near);
      alpha = max(alpha, water * near * mix(0.22, mix(body, 0.62, rim), close));
      // The glint: the sun, or the moon at night, off the drop's surface.
      vec3 surface = normalize(normal + (vAcross * bend.x + vUp * bend.y) * 1.5);
      float glint = pow(max(dot(reflect(-view, surface), uSunDirection), 0.0), 90.0) * uSun * 1.6;
      glint = clamp(glint * water, 0.0, 1.0);
      color = mix(color, uSky + vec3(0.3), glint);
      alpha = max(alpha, glint * near);
    }

    // Snow (D122, D136). Glass is slippery: on the roof it slides down each
    // pane and banks against the bar below it (the eave, or the purlin for
    // the upper panes); on the walls the wind piles it against the sill and
    // leaves a little on the mid rail and on the gable's tie. Above each bank
    // the glass is clear, so the plants are still seen: the twin goes before
    // the weather. A bank is a mound, not a sticker: lumpy, a lit crest, a
    // cool shade at its foot, a thin translucent edge and the faint shadow
    // it casts on the glass just above.
    if (uSnow > 0.002) {
      bool roof = abs(vWorldNormal.y) > 0.2;
      float onPane;
      float top;
      float along = vPane.x;
      if (roof) {
        float slope = clamp((height - ROOF_EAVE) / (1.0 - ROOF_EAVE), 0.0, 1.0);
        bool upper = slope > ROOF_PURLIN;
        onPane = upper ? (slope - ROOF_PURLIN) / (1.0 - ROOF_PURLIN) : slope / ROOF_PURLIN;
        along += upper ? 11.0 : 0.0;
        top = upper ? 0.3 : 0.42;
      } else if (height < WALL_RAIL) {
        onPane = (height - WALL_SILL) / (WALL_RAIL - WALL_SILL);
        top = 0.3;
      } else if (height < ROOF_EAVE) {
        onPane = (height - WALL_RAIL) / (ROOF_EAVE - WALL_RAIL);
        along += 5.0;
        top = 0.1;
      } else {
        onPane = (height - GABLE_TIE) / (1.0 - GABLE_TIE);
        along += 23.0;
        top = 0.07;
      }
      // The crest: a long, gentle wave along the bar.
      float wave = texture2D(uMistNoise, vec2(along * 1.6, 0.37)).r * 0.7
        + texture2D(uMistNoise, vec2(along * 5.0, 0.71)).r * 0.3;
      top *= uSnow * (0.55 + 0.9 * wave);
      float lumps = texture2D(uMistNoise, vPane * 3.1).r * 0.6
        + texture2D(uMistNoise, vPane * 13.0).r * 0.4;
      float h = onPane + (lumps - 0.5) * 0.025;
      float bank = (1.0 - smoothstep(top - 0.03, top + 0.008, h)) * step(0.0, onPane);
      float u = clamp(h / max(top, 0.001), 0.0, 1.0);
      // Its surface: grainy, a crest that catches the light, a shaded foot.
      float shade = 0.9 + 0.12 * lumps;
      shade += 0.11 * smoothstep(0.5, 0.82, u) * (1.0 - smoothstep(0.9, 1.0, u));
      vec3 tint = mix(vec3(0.8, 0.86, 0.95), vec3(1.0), smoothstep(0.0, 0.3, u));
      vec3 snow = uSnowColor * tint * shade;
      // A glint here and there in the sun, only where it is big enough to see.
      float spark = step(0.9965, hash(floor(vPane * 700.0))) * close * uSun * 0.5;
      snow += vec3(spark);
      // At night the lamp lights it from inside, warm.
      snow += uGlow * uGlowAmount * 0.6 * (1.0 - u * 0.5);
      // Its shadow on the glass just above the crest: it has thickness.
      float contact = smoothstep(top + 0.05, top, h) * (1.0 - bank) * step(0.0, onPane);
      color = mix(color, color * 0.6, contact * 0.5);
      alpha = max(alpha, alpha + contact * 0.1);
      color = mix(color, snow, bank);
      alpha = mix(alpha, mix(0.97, 0.62, smoothstep(0.82, 1.0, u)), bank);
    }

    gl_FragColor = vec4(color, clamp(alpha, 0.0, 1.0));
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export interface GlassLook {
  /** Glass tint (--scene-glass). */
  tint: Color;
  /** What the roof reflects (day: --scene-sky; night: the moon). */
  sky: Color;
  /** What the walls reflect (the page, --bg). */
  page: Color;
  /** The warm light from inside (--scene-night-glow). */
  glow: Color;
  /** 0 by day; a slight warm halo from inside at night. */
  glowAmount: number;
  /** The milky veil, edge strength and reflection: lower at night. */
  veil: number;
  edge: number;
  reflection: number;
}

/** By day the glass reads clearly; at night it nearly disappears into the dark. */
export const GLASS = {
  day: { veil: 0.13, edge: 0.4, reflection: 0.09 },
  night: { veil: 0.04, edge: 0.2, reflection: 0.03 },
} as const;

const DROP_TILE_SIZE = 512;
const MIST_TILE_SIZE = 128;

function repeating(texture: DataTexture): DataTexture {
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}

/** Made once, the first time the glass is built: no download, a few milliseconds. */
let waterTextures: { drops: DataTexture; mist: DataTexture } | null = null;

function water(): { drops: DataTexture; mist: DataTexture } {
  waterTextures ??= {
    drops: repeating(
      new DataTexture(dropTile(DROP_TILE_SIZE), DROP_TILE_SIZE, DROP_TILE_SIZE, RGBAFormat),
    ),
    mist: repeating(
      new DataTexture(mistTile(MIST_TILE_SIZE), MIST_TILE_SIZE, MIST_TILE_SIZE, RedFormat),
    ),
  };
  return waterTextures;
}

/** The soft blotches, also for the wet ground (D120). */
export function waterNoise(): DataTexture {
  return water().mist;
}

export function createGlassMaterial(look: GlassLook): ShaderMaterial {
  const textures = water();
  return new ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: {
      uTint: { value: look.tint.clone() },
      uSky: { value: look.sky.clone() },
      uPage: { value: look.page.clone() },
      uGlow: { value: look.glow.clone() },
      uVeil: { value: look.veil },
      uEdge: { value: look.edge },
      uReflection: { value: look.reflection },
      uGlowAmount: { value: look.glowAmount },
      uFog: { value: 0 },
      uFogColor: { value: new Color() },
      uFloor: { value: 0 },
      uHeight: { value: 1 },
      uRain: { value: 0 },
      uRainColor: { value: new Color() },
      uTime: { value: 0 },
      uDrops: { value: textures.drops },
      uMistNoise: { value: textures.mist },
      uRuns: { value: 1 },
      uSunDirection: { value: new Vector3(0, 1, 0) },
      uSun: { value: 1 },
      uSnow: { value: 0 },
      uSnowColor: { value: new Color() },
    },
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
  });
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/**
 * Sets the glass for this frame: day ↔ night through twilight (`night`,
 * the scene's light blend, A9) and the condensation (0–1). Never rebuilds
 * the material.
 */
export function setGlass(
  material: ShaderMaterial,
  input: {
    night: number;
    condensation: number;
    sky: Color;
    moon: Color;
    page: { day: Color; night: Color };
    fog: Color;
    /** Bottom and height of the greenhouse, in world units. */
    floor: number;
    height: number;
    /** Rain outside (0–1, A10), its colour, and the time that moves the drops. */
    rain: number;
    rainColor: Color;
    time: number;
    /** Drops running down: not in Baja (D118). */
    runs: boolean;
    /** Towards the sun, and how bright its glint is now (clouds, night). */
    sunDirection: Vector3;
    sun: number;
    /** Snow lying on the roof (0–1, D122), and its colour in this light. */
    snow: number;
    snowColor: Color;
  },
): void {
  const u = material.uniforms as Record<string, { value: unknown }>;
  const n = input.night;
  (u['uSky']?.value as Color).lerpColors(input.sky, input.moon, n);
  (u['uPage']?.value as Color).lerpColors(input.page.day, input.page.night, n);
  (u['uFogColor']?.value as Color).copy(input.fog);
  (u['uRainColor']?.value as Color).copy(input.rainColor);
  (u['uSunDirection']?.value as Vector3).copy(input.sunDirection);
  (u['uSnowColor']?.value as Color).copy(input.snowColor).multiplyScalar(lerp(1, 0.62, n));
  const set = (name: string, value: number) => {
    const uniform = u[name];
    if (uniform) uniform.value = value;
  };
  set('uGlowAmount', 0.35 * n);
  set('uVeil', lerp(GLASS.day.veil, GLASS.night.veil, n));
  set('uEdge', lerp(GLASS.day.edge, GLASS.night.edge, n));
  set('uReflection', lerp(GLASS.day.reflection, GLASS.night.reflection, n));
  // The mist is quieter at night, when the glass nearly disappears.
  set('uFog', input.condensation * lerp(1, 0.55, n));
  set('uFloor', input.floor);
  set('uHeight', input.height);
  set('uRain', input.rain);
  set('uTime', input.time);
  set('uRuns', input.runs ? 1 : 0);
  set('uSun', input.sun);
  set('uSnow', input.snow);
}
