import {
  BufferAttribute,
  CanvasTexture,
  MeshLambertMaterial,
  RepeatWrapping,
  SRGBColorSpace,
  Vector3,
} from 'three';
import type {
  BufferGeometry,
  Color,
  Matrix4,
  Texture,
  WebGLProgramParametersWithUniforms,
} from 'three';

/**
 * Materials of the diorama that need more than a flat colour. The geometry
 * comes from the .glb quantised (docs/04): local positions are not metres,
 * so the shaders work in world space.
 */

/**
 * Fine sand grain for the sunken tray (ref-03): small specks a touch lighter
 * and darker than the tray colour, drawn once into a tiling texture.
 */
export function createSandTexture(sand: Color, channel = 0): CanvasTexture | null {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (!context) return null;
  context.fillStyle = `#${sand.getHexString()}`;
  context.fillRect(0, 0, size, size);
  const light = `#${sand.clone().offsetHSL(0, -0.03, 0.04).getHexString()}`;
  const dark = `#${sand.clone().offsetHSL(0, 0.02, -0.05).getHexString()}`;
  const random = createRandom(7);
  for (let i = 0; i < 3200; i++) {
    context.fillStyle = random() < 0.5 ? light : dark;
    context.beginPath();
    context.arc(random() * size, random() * size, 0.5 + random() * 0.9, 0, Math.PI * 2);
    context.fill();
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  // The baked tray uses its first UV set for the lightmap: the grain uses another.
  texture.channel = channel;
  return texture;
}

function createRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 16807) % 2147483647;
    return state / 2147483647;
  };
}

/**
 * A copy of a flat geometry with texture coordinates laid from above, in the
 * UV set `attribute` (`uv1`: the first set holds the lightmap UV): one
 * texture repeat every `tile` metres.
 */
export function withPlanarUv(
  geometry: BufferGeometry,
  matrix: Matrix4,
  tile: number,
  attribute: 'uv' | 'uv1' = 'uv1',
) {
  const result = geometry.clone();
  const position = geometry.getAttribute('position');
  const uv = new Float32Array(position.count * 2);
  const point = new Vector3();
  for (let i = 0; i < position.count; i++) {
    point.fromBufferAttribute(position, i).applyMatrix4(matrix);
    uv[i * 2] = point.x / tile;
    uv[i * 2 + 1] = point.z / tile;
  }
  result.setAttribute(attribute, new BufferAttribute(uv, 2));
  return result;
}

/**
 * Matte sand (no specular, like clay). The sides of the plinth are a little
 * darker than the top, and darker still towards the bottom, so its edge
 * reads clearly against the white page. `top` is the plinth's height (m).
 */
export function createPlinthMaterial(color: Color, top: number): MeshLambertMaterial {
  const material = new MeshLambertMaterial({ color });
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vSide;\nvarying float vRise;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vSide = 1.0 - smoothstep(0.5, 0.9, normalize(mat3(modelMatrix) * normal).y);
        vRise = clamp((modelMatrix * vec4(position, 1.0)).y / ${top.toFixed(4)}, 0.0, 1.0);`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vSide;\nvarying float vRise;')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        diffuseColor.rgb *= mix(1.0, mix(0.84, 0.95, vRise), vSide);`,
      );
  };
  material.customProgramCacheKey = () => 'vitreo-plinth';
  return material;
}

export interface WetUniforms {
  /** How wet the ground is, 0-1 (`sceneWeather.wet`). */
  uWet: { value: number };
  /** Rain falling now, 0-1: rings on the puddles. */
  uWetRain: { value: number };
  /** The drops' clock: rings stand still with reduced motion. */
  uWetTime: { value: number };
  /** What wet ground reflects: the sky, or the moon at night. */
  uWetSky: { value: Color };
  /** Snow lying on what faces up, 0-1 (`sceneWeather.snowCover`, D122), and its colour. */
  uSnowCover: { value: number };
  uSnowColor: { value: Color };
  /**
   * What snow gives back at night (D136): the moon's light, which lifts it
   * above the dark ground as real snow does; black at day.
   */
  uSnowNight: { value: Color };
  /** Soft blotches (shaders/dropTile.ts): where it dries first, where water gathers. */
  uWetNoise: { value: Texture };
}

const PUDDLES_GLSL = `
          float pools = texture2D(uWetNoise, vWetPosition.xz * 5.3 + 0.4).r;
          wetPool = smoothstep(0.66, 0.84, pools) * smoothstep(0.45, 0.85, uWet) * lying;
          if (wetPool > 0.0 && uWetRain > 0.01) {
            vec2 spot = vWetPosition.xz * 34.0;
            vec2 cell = floor(spot);
            float seed = fract(sin(dot(cell, vec2(127.1, 311.7))) * 43758.5453);
            float life = fract(seed * 7.0 + uWetTime * (0.45 + 0.5 * seed));
            float radius = length(fract(spot) - 0.5);
            wetRing = (1.0 - smoothstep(0.0, 0.06, abs(radius - life * 0.48))) * (1.0 - life)
              * step(seed, uWetRain);
          }`;

/**
 * Wet ground (D120): darker and a little more saturated, as wet sand is, with
 * a soft sheen of the sky at low angles, drying in patches. `puddles` adds
 * small pools with rings where the rain falls on them (the path). Goes on top
 * of `bakedLight` or `probeLight`, which light `diffuseColor`. From the data
 * only: dry ground is left exactly as it was. Snow lies on it too (D122,
 * D136); `wet: false` keeps only the snow (the frame's bars: they shed rain).
 */
export function wetGround(uniforms: WetUniforms, puddles: boolean, wet = true) {
  return (shader: WebGLProgramParametersWithUniforms) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vWetPosition;
        varying float vWetUp;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vWetPosition = (modelMatrix * vec4(position, 1.0)).xyz;
        vWetUp = normalize(mat3(modelMatrix) * normal).y;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uWet;
        uniform float uWetRain;
        uniform float uWetTime;
        uniform vec3 uWetSky;
        uniform float uSnowCover;
        uniform vec3 uSnowColor;
        uniform vec3 uSnowNight;
        uniform sampler2D uWetNoise;
        varying vec3 vWetPosition;
        varying float vWetUp;
        const bool WET_GROUND = ${wet ? 'true' : 'false'};
        float wetSoak = 0.0;
        float snowCover = 0.0;
        float wetPool = 0.0;
        float wetRing = 0.0;`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        if (uWet > 0.002 && WET_GROUND) {
          float blotch = texture2D(uWetNoise, vWetPosition.xz * 2.4).r;
          // The sides shed water, and dry sooner than the top.
          float lying = smoothstep(0.2, 0.8, vWetUp);
          wetSoak = smoothstep(blotch - 0.22, blotch + 0.22, uWet * 1.5 - 0.25) * mix(0.42, 1.0, lying);
          diffuseColor.rgb = mix(diffuseColor.rgb, pow(diffuseColor.rgb, vec3(1.32)) * 0.8, wetSoak);
          ${puddles ? PUDDLES_GLSL : ''}
        }
        if (uSnowCover > 0.002) {
          // An even blanket on all that faces up (D136), thinner in places
          // so the ground shows through a little where the wind took it;
          // a cool shade where it is thinner. Blotches read as stains.
          float drift = texture2D(uWetNoise, vWetPosition.xz * 2.1).r * 0.7
            + texture2D(uWetNoise, vWetPosition.xz * 9.0).r * 0.3;
          snowCover = smoothstep(0.15, 0.55, uSnowCover * 1.25 - 0.4 * drift + 0.12)
            * smoothstep(0.55, 0.85, vWetUp);
          // Grainy, not a flat sheet: small lumps that catch the light.
          float lumps = texture2D(uWetNoise, vWetPosition.xz * 26.0).r;
          vec3 snow = uSnowColor * mix(vec3(1.0), vec3(0.88, 0.92, 0.98), drift)
            * (0.93 + 0.1 * lumps);
          diffuseColor.rgb = mix(diffuseColor.rgb, snow, snowCover);
          wetSoak *= 1.0 - snowCover;
          wetPool *= 1.0 - snowCover;
        }`,
      )
      .replace(
        '#include <opaque_fragment>',
        `outgoingLight += uSnowNight * snowCover;
        if (wetSoak > 0.0) {
          vec3 toEye = normalize(cameraPosition - vWetPosition);
          float grazing = pow(1.0 - max(toEye.y, 0.0), 2.0);
          outgoingLight += uWetSky * wetSoak * smoothstep(0.2, 0.8, vWetUp) * grazing * 0.2;
          // A pool holds a dim, soft image of the sky: darker than wet ground
          // at most angles, never a bright patch.
          outgoingLight = mix(outgoingLight, outgoingLight * 0.68 + uWetSky * 0.2, wetPool * 0.8);
          outgoingLight += uWetSky * wetRing * wetPool * 0.3;
        }
        #include <opaque_fragment>`,
      );
  };
}
