import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { BufferAttribute, BufferGeometry, ShaderMaterial, Vector3 } from 'three';
import type { Box3, Color, Mesh } from 'three';

import { useEffectiveQuality } from '../app/settings.ts';
import { waterNoise } from '../shaders/glass.ts';
import { sceneWeather } from './atmosphere.ts';

/**
 * Fog inside the scene (D122; replaces the CSS veil of A10): level sheets of
 * mist, stacked from the ground up and thinning as they rise, so the plinth
 * sinks into it and the roof stands above it. Soft blotches drift through
 * them, nearly aligned from sheet to sheet so they read as banks, with the
 * wind and at a slightly different pace per sheet. One mesh, one draw
 * call, not drawn at all without fog; fewer sheets in Baja. With reduced
 * motion it stands still, as the drops do.
 */
const SHEETS = { high: 7, low: 3 } as const;
/** How thick all the sheets add up to, in the thickest fog: it stays in sight. */
const THICKEST = 1.15;
/** How far out the fog reaches, in greenhouse widths, and how high it stacks. */
const SPREAD = 2.4;
const RISE = 1.05;

const vertexShader = /* glsl */ `
  attribute float sheet;
  varying vec3 vWorld;
  varying float vSheet;

  void main() {
    vSheet = sheet;
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const fragmentShader = /* glsl */ `
  uniform vec3 uColor;
  uniform float uFog;
  uniform float uTime;
  uniform float uWind;
  uniform float uEach;
  uniform vec2 uCentre;
  uniform float uReach;
  uniform sampler2D uNoise;
  varying vec3 vWorld;
  varying float vSheet;

  void main() {
    // Each sheet drifts on its own, a little faster as it rises.
    float pace = 0.008 + 0.006 * vSheet + 0.02 * uWind;
    vec2 at = vWorld.xz + vSheet * vec2(0.22, 0.12);
    float wide = texture2D(uNoise, at * 0.8 + vec2(uTime * pace, uTime * pace * 0.4)).r;
    float fine = texture2D(uNoise, at * 2.1 - vec2(uTime * pace * 1.6, 0.0)).r;
    float cloud = smoothstep(0.32, 0.72, wide * 0.7 + fine * 0.3);
    // Thick low down, wispy higher up; dissolving before its edge.
    float low = mix(1.5, 0.4, vSheet);
    float fade = 1.0 - smoothstep(0.42, 1.0, length(vWorld.xz - uCentre) / uReach);
    float alpha = uFog * uEach * low * mix(0.14, 1.0, cloud) * fade;
    gl_FragColor = vec4(uColor, alpha);
    #include <colorspace_fragment>
  }
`;

export function FogBanks({ body, color }: { body: Box3; color: Color }) {
  const quality = useEffectiveQuality();
  const count = quality === 'high' ? SHEETS.high : SHEETS.low;
  const { geometry, material, update } = useMemo(() => {
    const size = body.getSize(new Vector3());
    const centre = body.getCenter(new Vector3());
    const reach = Math.max(size.x, size.z) * SPREAD;
    const positions = new Float32Array(count * 4 * 3);
    const sheets = new Float32Array(count * 4);
    const index: number[] = [];
    for (let i = 0; i < count; i++) {
      const rise = i / Math.max(1, count - 1);
      const y = body.min.y + size.y * RISE * rise;
      const corners = [
        [centre.x - reach, y, centre.z - reach],
        [centre.x + reach, y, centre.z - reach],
        [centre.x + reach, y, centre.z + reach],
        [centre.x - reach, y, centre.z + reach],
      ];
      corners.forEach((corner, c) => {
        positions.set(corner, (i * 4 + c) * 3);
        sheets[i * 4 + c] = rise;
      });
      const base = i * 4;
      index.push(base, base + 2, base + 1, base, base + 3, base + 2);
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(positions, 3));
    geometry.setAttribute('sheet', new BufferAttribute(sheets, 1));
    geometry.setIndex(index);
    const material = new ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        uColor: { value: color.clone() },
        uFog: { value: 0 },
        uTime: { value: 0 },
        uWind: { value: 0 },
        uEach: { value: THICKEST / count },
        uCentre: { value: { x: centre.x, y: centre.z } },
        uReach: { value: reach },
        uNoise: { value: waterNoise() },
      },
      transparent: true,
      depthWrite: false,
    });
    const u = material.uniforms as Record<string, { value: number }>;
    const update = (fog: number, time: number, wind: number) => {
      if (u['uFog']) u['uFog'].value = fog;
      if (u['uTime']) u['uTime'].value = time;
      if (u['uWind']) u['uWind'].value = wind;
    };
    return { geometry, material, update };
  }, [body, color, count]);
  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );

  const mesh = useRef<Mesh>(null);
  useFrame(() => {
    update(sceneWeather.fog, sceneWeather.time, sceneWeather.wind);
    if (mesh.current) mesh.current.visible = sceneWeather.fog > 0.01;
  });

  // After the glass, so it veils what is seen through it too.
  return (
    <mesh
      ref={mesh}
      geometry={geometry}
      material={material}
      frustumCulled={false}
      renderOrder={5}
    />
  );
}
