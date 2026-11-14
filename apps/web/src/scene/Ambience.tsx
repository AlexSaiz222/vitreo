import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  NormalBlending,
  ShaderMaterial,
  Vector2,
  Vector3,
  Vector4,
} from 'three';
import type { Box3, Color, Object3D, Points } from 'three';

import { useEffectiveQuality, useSettings } from '../app/settings.ts';
import { sceneReading } from '../data/sceneReading.ts';
import { now as nowMs } from '../app/clock.ts';
import { outdoorNow, rainRecord } from '../data/weather.ts';
import {
  dustFor,
  firefliesFor,
  particleCounts,
  sceneWeather,
  sceneWind,
  weatherLook,
  wetnessFor,
  windFor,
} from './atmosphere.ts';
import type { SceneWeather } from './atmosphere.ts';
import { FogBanks } from './FogBanks.tsx';
import type { NightBlend } from './Lights.tsx';
import type { ScenePalette } from './palette.ts';
import { Rain } from './Rain.tsx';
import { useReducedMotion } from './useReducedMotion.ts';

/** How quickly things follow the data (seconds); the sky changes slowly, as it does. */
const EASE = {
  wind: 2.5,
  dust: 4,
  fireflies: 3,
  weather: 10,
  falling: 5,
  wet: 12,
  snowCover: 30,
} as const;
/** The weather is looked at this often (it changes every few minutes at most). */
const WEATHER_EVERY_S = 1;

/**
 * The quiet life of the diorama (A9, D96): the wind on the leaves from the
 * fan and the window, dust motes in the sunlight by day and a few soft
 * fireflies at night. Each particle system is one draw call, animated in
 * its shader; nothing re-renders React per frame. Fewer particles in Auto,
 * none in Baja or with reduced motion, and none while the scene sleeps.
 *
 * The weather outside (A10): calm rain (Rain.tsx, D119) or a few snowflakes
 * around the greenhouse (never inside it), and its clouds, fog and wind eased into
 * `sceneWeather` for the light, the glass and the plants outside. The wind
 * outside reaches the leaves only through the open window.
 */
export function Atmosphere({
  nodes,
  palette,
  body,
  night,
  sleeping,
}: {
  nodes: Record<string, Object3D>;
  palette: ScenePalette;
  /** The greenhouse itself: the dust stays inside, the fireflies outside. */
  body: Box3;
  night: NightBlend;
  sleeping: boolean;
}) {
  const reducedMotion = useReducedMotion();
  const quality = useEffectiveQuality();
  const auto = useSettings((state) => state.quality === 'auto');
  const counts = particleCounts({ quality, auto, reducedMotion });
  const wind = useRef({ strength: 1, speed: 1 });
  const weather = useRef<{ target: SceneWeather; wet: number; checked: number; seen: boolean }>({
    target: weatherLook(null),
    wet: 0,
    checked: -Infinity,
    seen: false,
  });

  useFrame((state, delta) => {
    // The weather outside (A10): looked at once a second, eased every frame.
    const w = weather.current;
    if (state.clock.elapsedTime - w.checked >= WEATHER_EVERY_S) {
      const now = outdoorNow();
      w.target = weatherLook(now);
      w.wet = now ? wetnessFor(rainRecord(), nowMs() / 1000, w.target.rain) : 0;
      w.checked = state.clock.elapsedTime;
      // The first weather of the visit is how it is: no fade from calm.
      if (now && !w.seen) {
        Object.assign(sceneWeather, w.target, { wet: w.wet, snowCover: w.target.snow });
      }
      w.seen ||= now !== null;
    }
    const sky = 1 - Math.exp(-delta / EASE.weather);
    for (const key of ['clouds', 'rain', 'snow', 'fog', 'wind'] as const) {
      sceneWeather[key] += (w.target[key] - sceneWeather[key]) * sky;
    }
    sceneWeather.wet += (w.wet - sceneWeather.wet) * (1 - Math.exp(-delta / EASE.wet));
    sceneWeather.snowCover +=
      (w.target.snow - sceneWeather.snowCover) * (1 - Math.exp(-delta / EASE.snowCover));
    // Drops on the glass run down; they stand still with reduced motion.
    if (!reducedMotion) sceneWeather.time += delta;

    // Wind from the data: the fan blows on the leaves, the window lets a
    // draught in, and with it the wind outside.
    const target = windFor({
      fan: sceneReading.fan(),
      vent: sceneReading.vent(),
      live: sceneReading.live(),
      outside: sceneWeather.wind,
    });
    const ease = 1 - Math.exp(-delta / EASE.wind);
    wind.current.strength += (target.strength - wind.current.strength) * ease;
    wind.current.speed += (target.speed - wind.current.speed) * ease;
    // Decorative motion stops with reduced motion (docs/02).
    sceneWind.time = reducedMotion ? 0 : sceneWind.time + delta * wind.current.speed;
    sceneWind.strength = wind.current.strength;
  });

  return (
    <>
      {counts.dust > 0 && (
        <Particles
          kind="dust"
          count={counts.dust}
          body={body}
          color={palette.dust}
          target={() =>
            sleeping
              ? 0
              : dustFor({ night: night.current.uNightMix.value, lux: sceneReading.lux() })
          }
          ease={EASE.dust}
        />
      )}
      {counts.fireflies > 0 && (
        <Particles
          kind="fireflies"
          count={counts.fireflies}
          body={body}
          color={palette.firefly}
          target={() =>
            sleeping
              ? 0
              : // No fireflies out in the rain, the snow or the fog.
                firefliesFor(night.current.uNightMix.value) *
                (1 - Math.max(sceneWeather.rain, sceneWeather.snow, sceneWeather.fog))
          }
          ease={EASE.fireflies}
        />
      )}
      <FogBanks body={body} color={palette.fog} />
      {counts.rain > 0 && (
        <Rain nodes={nodes} body={body} color={palette.rainStreak} counts={counts} />
      )}
      {counts.snow > 0 && (
        <Particles
          kind="snow"
          count={counts.snow}
          body={body}
          color={palette.snow}
          target={() => sceneWeather.snow}
          ease={EASE.falling}
        />
      )}
    </>
  );
}

const vertexShader = /* glsl */ `
  uniform float uTime;
  uniform float uSize;
  uniform float uPixels;
  uniform vec3 uMin;
  uniform vec3 uSpan;
  // 0 dust, 1 fireflies, 3 snow.
  uniform float uKind;
  // The greenhouse (centre x, z and half size x, z): nothing falls inside it.
  uniform vec4 uBody;
  uniform float uWind;
  attribute vec4 seed;
  varying float vGlow;
  varying float vSpin;

  void main() {
    float t = uTime;
    vec3 p = uMin + seed.xyz * uSpan;
    if (uKind > 1.5) {
      // Snow falls slowly, drifting, slanted by the wind.
      float speed = 0.07 + 0.04 * seed.w;
      float fall = fract(seed.y + t * speed);
      p.y = uMin.y + (1.0 - fall) * uSpan.y;
      p.x += fall * uWind * uSpan.y * 0.4;
      p.x += sin(t * 0.6 + seed.w * 6.28) * 0.02 * uSpan.x;
      p.z += cos(t * 0.5 + seed.x * 6.28) * 0.02 * uSpan.z;
      // Fading in at the top and out at the bottom.
      vGlow = smoothstep(0.0, 0.12, fall) * (1.0 - smoothstep(0.88, 1.0, fall));
      bool inside = abs(p.x - uBody.x) < uBody.z && abs(p.z - uBody.y) < uBody.w;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      // Flakes of different sizes, a few much bigger, turning as they fall.
      vSpin = t * (0.3 + 0.9 * seed.x) * (seed.z > 0.5 ? 1.0 : -1.0) + seed.w * 6.28;
      float flake = 0.5 + 1.15 * seed.w * seed.w;
      gl_PointSize = inside
        ? 0.0
        : flake * uSize * projectionMatrix[1][1] * uPixels * 0.5 / gl_Position.w;
      if (inside) vGlow = 0.0;
      return;
    }
    bool fireflies = uKind > 0.5;
    float wander = fireflies ? 0.06 : 0.025;
    // Slow, uneven drift: three sines per axis never line up into a loop.
    p.x += (sin(t * 0.11 + seed.w * 6.28) + 0.5 * sin(t * 0.23 + seed.y * 9.0)) * uSpan.x * wander;
    p.z += (cos(t * 0.09 + seed.w * 4.1) + 0.5 * sin(t * 0.19 + seed.x * 7.0)) * uSpan.z * wander;
    if (fireflies) {
      p.y += sin(t * 0.3 + seed.w * 5.0) * uSpan.y * 0.08;
      // A slow pulse, now and then: mostly dim, briefly bright.
      vGlow = 0.35 + 0.65 * pow(max(0.0, sin(t * 0.45 + seed.w * 6.28)), 4.0);
    } else {
      // Motes rise and settle very slowly, wrapping inside the greenhouse.
      p.y = uMin.y + fract(seed.y + t * 0.006 * (0.5 + seed.w)) * uSpan.y;
      float edge = fract(seed.y + t * 0.006 * (0.5 + seed.w));
      vGlow = smoothstep(0.0, 0.15, edge) * (1.0 - smoothstep(0.85, 1.0, edge));
      // They catch the light as they turn.
      vGlow *= 0.55 + 0.45 * sin(t * 0.7 + seed.w * 20.0);
    }
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
    // uSize metres across, on screen: right for the orthographic camera
    // (w = 1) and the perspective one alike.
    gl_PointSize = uSize * projectionMatrix[1][1] * uPixels * 0.5 / gl_Position.w;
  }
`;

const fragmentShader = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  uniform float uKind;
  varying float vGlow;
  varying float vSpin;

  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float shape;
    vec3 color = uColor;
    if (uKind > 2.5) {
      // A snowflake: a soft blur, barely six-lobed and turning (a clear star
      // reads as a cartoon), with a faint grey rim, so it shows against a
      // pale winter page as well as at night.
      float d = length(c);
      float angle = atan(c.y, c.x) + vSpin;
      float edge = 0.36 + 0.035 * cos(angle * 6.0);
      shape = 1.0 - smoothstep(edge - 0.2, edge + 0.08, d);
      color = mix(uColor, uColor * 0.78, smoothstep(0.14, 0.38, d));
    } else {
      float soft = smoothstep(0.5, 0.0, length(c));
      // A small core and a faint halo.
      shape = soft * soft * soft + 0.25 * soft;
    }
    gl_FragColor = vec4(color, shape * vGlow * uOpacity);
  }
`;

const SETTINGS = {
  // Size in metres (the diorama is at real size, D59), with its soft edge.
  dust: { size: 0.011, opacity: 0.9, kind: 0 },
  fireflies: { size: 0.022, opacity: 1, kind: 1 },
  snow: { size: 0.021, opacity: 0.9, kind: 3 },
} as const;
type Kind = keyof typeof SETTINGS;

function Particles({
  kind,
  count,
  body,
  color,
  target,
  ease,
}: {
  kind: Kind;
  count: number;
  body: Box3;
  color: Color;
  /** How visible they should be now (0–1), read every frame. */
  target: () => number;
  ease: number;
}) {
  const { geometry, material, update } = useMemo(() => {
    const seeds = new Float32Array(count * 4);
    // A fixed sequence: the same places every visit (and in captures).
    let state = 7 + 6 * SETTINGS[kind].kind;
    const random = () => {
      state = (state * 16807) % 2147483647;
      return state / 2147483647;
    };
    for (let i = 0; i < count; i++) {
      seeds.set([random(), random(), random(), random()], i * 4);
    }
    const geometry = new BufferGeometry();
    // Positions come from the seeds in the shader; three needs a position attribute.
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(count * 3), 3));
    geometry.setAttribute('seed', new BufferAttribute(seeds, 4));
    const size = body.getSize(new Vector3());
    // Dust inside the greenhouse; fireflies in a wider ring around it, low
    // down; snow around it, from well above the roof.
    const ring = (wide: number) =>
      body.min.clone().set(body.min.x - size.x * wide, body.min.y, body.min.z - size.z * wide);
    const min =
      kind === 'dust'
        ? body.min.clone().addScaledVector(size, 0.08)
        : ring(kind === 'fireflies' ? 0.35 : 0.6);
    const span =
      kind === 'dust'
        ? size.clone().multiplyScalar(0.84)
        : kind === 'fireflies'
          ? size.clone().set(size.x * 1.7, size.y * 0.55, size.z * 1.7)
          : size.clone().set(size.x * 2.2, size.y * 1.6, size.z * 2.2);
    const centre = body.getCenter(new Vector3());
    const material = new ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        uTime: { value: 0 },
        uSize: { value: SETTINGS[kind].size },
        uPixels: { value: 1 },
        uMin: { value: min },
        uSpan: { value: span },
        uKind: { value: SETTINGS[kind].kind },
        // Half the greenhouse, and a little more for the eaves.
        uBody: { value: new Vector4(centre.x, centre.z, size.x * 0.56, size.z * 0.56) },
        uWind: { value: 0 },
        uColor: { value: color.clone() },
        uOpacity: { value: 0 },
      },
      transparent: true,
      depthWrite: false,
      // Fireflies glow (they add light); dust is golden specks, seen on the
      // pale floor as much as against the leaves.
      blending: kind === 'fireflies' ? AdditiveBlending : NormalBlending,
    });
    const u = material.uniforms as Record<string, { value: number }>;
    /** This frame's time, drawing height (px), opacity and wind outside. */
    const update = (time: number, pixels: number, opacity: number, wind: number) => {
      if (u['uTime']) u['uTime'].value = time;
      if (u['uPixels']) u['uPixels'].value = pixels;
      if (u['uOpacity']) u['uOpacity'].value = opacity;
      if (u['uWind']) u['uWind'].value = wind;
    };
    return { geometry, material, update };
  }, [kind, count, body, color]);
  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );

  const visible = useRef(0);
  const points = useRef<Points>(null);
  useFrame((state, delta) => {
    visible.current += (target() - visible.current) * (1 - Math.exp(-delta / ease));
    // Not drawn at all while invisible (dust at night, fireflies by day).
    if (points.current) points.current.visible = visible.current > 0.01;
    update(
      state.clock.elapsedTime,
      state.gl.getDrawingBufferSize(DRAWING).y,
      visible.current * SETTINGS[kind].opacity,
      sceneWeather.wind,
    );
  });

  return <points ref={points} geometry={geometry} material={material} frustumCulled={false} />;
}

/** Reused every frame: the drawing buffer's size. */
const DRAWING = new Vector2();
