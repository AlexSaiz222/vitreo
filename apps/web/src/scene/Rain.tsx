import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import {
  BufferAttribute,
  BufferGeometry,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  ShaderMaterial,
  Vector2,
  Vector3,
  Vector4,
} from 'three';
import type { Box3, Color, Group, Mesh, Object3D } from 'three';

import { sceneWeather } from './atmosphere.ts';
import type { ParticleCounts } from './atmosphere.ts';
import { surfaceSamples } from './surfaceSamples.ts';
import type { SampleMesh } from './surfaceSamples.ts';

/**
 * Rain with volume (D119), calm rather than a storm (D96), one draw call per
 * kind and all of it animated in shaders:
 * - streaks at three depths, the nearer ones longer, thicker and faster,
 *   slanted and stretched by the wind outside; a drizzle draws fewer of them;
 * - splashes where it lands, on the diorama's real surfaces;
 * - drips from the underside of the gutter, which go on for a while after
 *   the rain, while the ground is still wet (D120).
 * Nothing falls inside the greenhouse. None in Baja or with reduced motion.
 */

/** How quickly it comes and goes: rain does not start at a stroke. */
const EASE_SECONDS = 5;

/** Reused every frame: the drawing buffer's size. */
const DRAWING = new Vector2();

const streakVertex = /* glsl */ `
  uniform float uTime;
  uniform float uAmount;
  uniform float uWind;
  uniform float uPixels;
  uniform float uDepth;
  uniform vec3 uMin;
  uniform vec3 uSpan;
  uniform vec4 uBody;
  attribute vec4 seed;
  varying vec2 vCorner;
  varying float vFade;

  void main() {
    vCorner = position.xy;
    // A drizzle draws fewer drops, not fainter ones.
    float look = floor(seed.w * 3.0) * 0.5;
    float pick = fract(seed.w * 37.0);
    float speed = mix(0.95, 1.5, look) * (0.9 + 0.2 * pick);
    float fall = fract(seed.y + uTime * speed);
    vec3 towards = vec3(viewMatrix[0][2], 0.0, viewMatrix[2][2]);
    vec3 p = uMin + seed.xyz * uSpan;
    p.y = uMin.y + (1.0 - fall) * uSpan.y;
    p.x += (fall - 0.5) * uWind * uSpan.y * 0.32;
    p += normalize(towards) * (look - 0.5) * uDepth;
    bool inside = abs(p.x - uBody.x) < uBody.z && abs(p.z - uBody.y) < uBody.w;
    bool shown = pick < uAmount * 1.2 && !inside;
    // In from above, out at the ground, and thinning towards the edge of the
    // rain, so there is no box in the air.
    vec2 fromMiddle = (p.xz - (uMin.xz + 0.5 * uSpan.xz)) / (0.5 * uSpan.xz);
    float edge = 1.0 - smoothstep(0.62, 1.0, length(fromMiddle));
    vFade = shown ? smoothstep(0.0, 0.1, fall) * (1.0 - smoothstep(0.93, 1.0, fall)) * edge : 0.0;

    vec3 direction = normalize(vec3(uWind * 0.32, -1.0, 0.0));
    vec3 facing = vec3(viewMatrix[0][2], viewMatrix[1][2], viewMatrix[2][2]);
    vec3 side = normalize(cross(direction, facing));
    float length_ = mix(0.05, 0.12, look) * (1.0 + 0.5 * uWind) * (0.8 + 0.4 * pick);
    // Never thinner than about a pixel, or it shimmers.
    float pixel = 2.0 / (projectionMatrix[1][1] * uPixels);
    float width = max(mix(0.0011, 0.0024, look), pixel * 1.15);
    p += direction * position.y * length_ + side * position.x * width;
    gl_Position = shown ? projectionMatrix * viewMatrix * vec4(p, 1.0) : vec4(0.0, 0.0, 2.0, 1.0);
    vFade *= mix(0.4, 1.0, look);
  }
`;

const streakFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  varying vec2 vCorner;
  varying float vFade;

  void main() {
    // Soft across, and fading up the tail: y runs -0.5 (top) to 0.5 (bottom).
    float across = 1.0 - smoothstep(0.15, 0.5, abs(vCorner.x));
    float along = smoothstep(-0.5, 0.35, vCorner.y) * (1.0 - smoothstep(0.42, 0.5, vCorner.y));
    gl_FragColor = vec4(uColor, across * along * vFade * uOpacity);
    #include <colorspace_fragment>
  }
`;

const splashVertex = /* glsl */ `
  uniform float uTime;
  uniform float uAmount;
  uniform float uPixels;
  attribute vec3 seed;
  varying float vLife;

  void main() {
    float cycle = fract(seed.x + uTime * (0.5 + 0.7 * seed.y));
    vLife = cycle / 0.26;
    bool shown = vLife < 1.0 && seed.z < uAmount * 1.15;
    vec4 clip = projectionMatrix * viewMatrix * vec4(position + vec3(0.0, 0.002, 0.0), 1.0);
    gl_Position = clip;
    float size = mix(0.008, 0.028, sqrt(min(vLife, 1.0))) * (0.7 + 0.6 * seed.y);
    gl_PointSize = shown ? size * projectionMatrix[1][1] * uPixels * 0.5 / clip.w : 0.0;
  }
`;

const splashFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  varying float vLife;

  void main() {
    // A ring on a surface seen at an angle, spreading and fading out.
    vec2 c = (gl_PointCoord - 0.5) * vec2(2.0, 3.6);
    float r = length(c);
    float ring = 1.0 - smoothstep(0.0, 0.14, abs(r - mix(0.2, 0.86, vLife)));
    float crown = (1.0 - smoothstep(0.0, 0.3, r)) * (1.0 - smoothstep(0.0, 0.3, vLife));
    float alpha = (ring * (1.0 - vLife) + crown) * uOpacity;
    if (alpha < 0.004) discard;
    gl_FragColor = vec4(uColor, alpha);
    #include <colorspace_fragment>
  }
`;

const dripVertex = /* glsl */ `
  uniform float uTime;
  uniform float uAmount;
  uniform float uPixels;
  uniform float uGround;
  attribute vec3 seed;
  varying float vFade;

  void main() {
    float cycle = fract(seed.x + uTime * (0.22 + 0.3 * seed.y));
    float t = cycle / 0.34;
    bool shown = t < 1.0 && seed.z < uAmount * 1.1;
    // It swells at the gutter's edge, lets go and accelerates.
    float fall = max(0.0, (t - 0.25) / 0.75);
    vec3 p = position;
    p.y = mix(position.y, uGround, fall * fall);
    vec4 clip = projectionMatrix * viewMatrix * vec4(p, 1.0);
    gl_Position = clip;
    vFade = smoothstep(0.0, 0.25, t) * (1.0 - smoothstep(0.9, 1.0, t));
    float size = mix(0.008, 0.018, fall);
    gl_PointSize = shown ? size * projectionMatrix[1][1] * uPixels * 0.5 / clip.w : 0.0;
  }
`;

const dripFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  varying float vFade;

  void main() {
    vec2 c = gl_PointCoord - 0.5;
    // Rounder below, tapering above.
    float width = mix(0.2, 0.07, smoothstep(-0.05, -0.5, c.y));
    float shape = (1.0 - smoothstep(width * 0.5, width, abs(c.x)))
      * (1.0 - smoothstep(0.3, 0.5, abs(c.y)));
    gl_FragColor = vec4(uColor, shape * vFade * uOpacity);
    #include <colorspace_fragment>
  }
`;

function isMesh(object: Object3D): object is Mesh {
  return (object as Partial<Mesh>).isMesh === true;
}

function meshesOf(root: Object3D | undefined): SampleMesh[] {
  const meshes: SampleMesh[] = [];
  root?.updateWorldMatrix(true, true);
  root?.traverse((object) => {
    if (isMesh(object)) meshes.push(object);
  });
  return meshes;
}

function randomFrom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 16807) % 2147483647;
    return state / 2147483647;
  };
}

function seeds(count: number, size: number, seed: number): Float32Array {
  const random = randomFrom(seed);
  return Float32Array.from({ length: count * size }, () => random());
}

function shaderMaterial(
  vertexShader: string,
  fragmentShader: string,
  uniforms: Record<string, { value: unknown }>,
): ShaderMaterial {
  return new ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms,
    transparent: true,
    depthWrite: false,
  });
}

function pointsGeometry(positions: Float32Array, seed: number): BufferGeometry {
  const count = positions.length / 3;
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('seed', new BufferAttribute(seeds(count, 3, seed), 3));
  return geometry;
}

export function Rain({
  nodes,
  body,
  color,
  counts,
}: {
  nodes: Record<string, Object3D>;
  /** The greenhouse itself: nothing falls inside it. */
  body: Box3;
  color: Color;
  counts: Pick<ParticleCounts, 'rain' | 'splashes' | 'drips'>;
}) {
  const { streaks, splashes, drips, materials, update } = useMemo(() => {
    const size = body.getSize(new Vector3());
    const centre = body.getCenter(new Vector3());
    const min = new Vector3(body.min.x - size.x * 0.75, body.min.y, body.min.z - size.z * 0.75);
    const span = new Vector3(size.x * 2.5, size.y * 1.7, size.z * 2.5);
    const shared = {
      uTime: { value: 0 },
      uAmount: { value: 0 },
      uWind: { value: 0 },
      uPixels: { value: 1 },
      uColor: { value: color.clone() },
    };

    // A thin quad per drop, y from -0.5 (its tail) to 0.5 (its head).
    const streaks = new InstancedBufferGeometry();
    streaks.setAttribute(
      'position',
      new BufferAttribute(
        // prettier-ignore
        new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]),
        3,
      ),
    );
    streaks.setIndex([0, 1, 2, 0, 2, 3]);
    streaks.setAttribute('seed', new InstancedBufferAttribute(seeds(counts.rain, 4, 7), 4));
    streaks.instanceCount = counts.rain;
    const streakMaterial = shaderMaterial(streakVertex, streakFragment, {
      ...shared,
      uOpacity: { value: 0.85 },
      uDepth: { value: size.x * 0.9 },
      uMin: { value: min },
      uSpan: { value: span },
      // Half the greenhouse, and a little more for the eaves.
      uBody: { value: new Vector4(centre.x, centre.z, size.x * 0.56, size.z * 0.56) },
    });

    // Rain lands on what faces up: the roof's glass and the ground around it,
    // not the floor under the roof.
    const underRoof = (at: Vector3) =>
      Math.abs(at.x - centre.x) < size.x * 0.5 && Math.abs(at.z - centre.z) < size.z * 0.5;
    const ground = ['base', 'gravel', 'path', 'steps'].flatMap((name) => meshesOf(nodes[name]));
    const roof = meshesOf(nodes['glass_main']);
    const landing = new Float32Array(counts.splashes * 3);
    const onRoof = Math.round(counts.splashes * 0.4);
    landing.set(surfaceSamples(roof, onRoof, (normal) => normal.y > 0.25, 19));
    landing.set(
      surfaceSamples(
        ground,
        counts.splashes - onRoof,
        (normal, at) => normal.y > 0.8 && !underRoof(at),
        23,
      ),
      onRoof * 3,
    );
    const splashMaterial = shaderMaterial(splashVertex, splashFragment, {
      ...shared,
      uOpacity: { value: 0.5 },
    });

    // Water leaves the gutter from its underside.
    const edge = surfaceSamples(
      meshesOf(nodes['gutter']),
      counts.drips,
      (normal) => normal.y < -0.3,
      29,
    );
    const dripMaterial = shaderMaterial(dripVertex, dripFragment, {
      ...shared,
      uOpacity: { value: 0.8 },
      uGround: { value: body.min.y },
    });

    const materials = {
      streak: streakMaterial,
      splash: splashMaterial,
      drip: dripMaterial,
    };
    const update = (time: number, amount: number, drip: number, wind: number, pixels: number) => {
      for (const material of Object.values(materials)) {
        const u = material.uniforms as Record<string, { value: number }>;
        if (u['uTime']) u['uTime'].value = time;
        if (u['uAmount']) u['uAmount'].value = material === materials.drip ? drip : amount;
        if (u['uWind']) u['uWind'].value = wind;
        if (u['uPixels']) u['uPixels'].value = pixels;
      }
    };
    return {
      streaks,
      splashes: pointsGeometry(landing, 31),
      drips: pointsGeometry(edge, 37),
      materials,
      update,
    };
  }, [nodes, body, color, counts.rain, counts.splashes, counts.drips]);

  useEffect(
    () => () => {
      streaks.dispose();
      splashes.dispose();
      drips.dispose();
      for (const material of Object.values(materials)) material.dispose();
    },
    [streaks, splashes, drips, materials],
  );

  const shown = useRef(0);
  const group = useRef<Group>(null);
  useFrame((state, delta) => {
    shown.current += (sceneWeather.rain - shown.current) * (1 - Math.exp(-delta / EASE_SECONDS));
    const pixels = state.gl.getDrawingBufferSize(DRAWING).y;
    // After the rain the gutter drips on, less and less, as the ground dries.
    const drip = Math.max(shown.current, sceneWeather.wet * 0.6);
    update(state.clock.elapsedTime, shown.current, drip, sceneWeather.wind, pixels);
    // Not drawn at all while dry.
    if (group.current) group.current.visible = drip > 0.01;
  });

  return (
    <group ref={group}>
      <mesh geometry={streaks} material={materials.streak} frustumCulled={false} />
      <points geometry={splashes} material={materials.splash} frustumCulled={false} />
      <points geometry={drips} material={materials.drip} frustumCulled={false} />
    </group>
  );
}
