import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { Box3, Color, MeshBasicMaterial, Object3D, Vector3 } from 'three';
import type { DirectionalLight, HemisphereLight, PointLight } from 'three';

import { overcastLight, sceneWeather, SUN_DIRECTION } from './atmosphere.ts';
import { areaOf, castShadow, createGroundShadowTexture, footprint } from './groundShadow.ts';
import type { ScenePalette } from './palette.ts';

/**
 * The sun of the Blender bake (`preview_sun` in build_greenhouse.py: its
 * light travels along (0.25, 1, -0.85) in Blender, Z up). It lights the parts
 * that are not baked, and sets where the long shadow on the page falls:
 * from the front, a little from the left, back over the plinth (ref-03).
 */
/**
 * Every distance below is a multiple of the diorama's width (the plinth with
 * its steps), so the light follows the model's real size (D57).
 */
const SCALE = {
  sunDistance: 1.46,
  /** The contact shadow where the plinth meets the page: its blur. */
  groundBlur: 0.025,
  /** The long shadow of the greenhouse on the page: very soft (ref-03). */
  castBlur: 0.06,
  /** Night: how far the warm light inside reaches. */
  nightLightReach: 1.44,
} as const;
/** Night light height, as a share of the diorama's height (at the eaves). */
const NIGHT_LIGHT_HEIGHT = 0.64;
/**
 * The night light was tuned on the phase 1 toy scene, 3.2 m wide. With
 * decay 1 a smaller scene needs proportionally less intensity. The grow
 * light adds its own light (GreenhouseModel), by day and by night.
 */
const NIGHT_LIGHT = { intensity: 3.2, tunedWidth: 3.2 } as const;

/** How dark the shadow under the plinth is, by day and by night. */
const GROUND_SHADOW = { day: 0.36, night: 0.45 } as const;
/**
 * The long shadow, relative to the contact one: faint, the greenhouse is
 * mostly glass. Only by day. It falls from this share of the greenhouse's
 * height (its walls; the ridge is a line).
 */
const CAST_SHADOW = { strength: 0.62, height: 0.8 } as const;

/** How much of the sun's warmth tints the light (the rest is white). */
const SUN_WARMTH = 0.35;

/**
 * Light for what is not baked (glass, leaves, devices, details) and the
 * soft shadows on the page. The baked parts ignore these lights. No shadow
 * map: the page shadows are static textures, drawn once (D67).
 *
 * Day: the sun of the bake, only slightly warm, and a warm sky fill.
 * Night: a warm pool of light inside, a faint cool moon, a warm bounce.
 * Sleeping (disconnected): the same, with neutral instead of warm light.
 *
 * Day and night blend through twilight (A9): the same lights, their colours
 * and strengths following the scene's night blend every frame (the one the
 * lightmaps use), and the sun's long shadow fades with the day.
 *
 * Clouds (A10): the sun weaker, its long shadow fading, the sky's fill a
 * little stronger: the soft light of a grey day.
 */
export function Lights({
  palette,
  sleeping,
  bounds,
  ground,
  body,
  night,
}: {
  palette: ScenePalette;
  sleeping: boolean;
  /** The whole diorama, from the model. */
  bounds: Box3;
  /** What stands on the page (plinth, steps). */
  ground: readonly Box3[];
  /** The greenhouse itself, for its long shadow. */
  body: Box3;
  /** The scene's night blend (0 day, 1 night), read every frame. */
  night: NightBlend;
}) {
  const sun = useMemo(() => new Color(1, 1, 1).lerp(palette.sun, SUN_WARMTH), [palette.sun]);
  const layout = useMemo(() => {
    const size = bounds.getSize(new Vector3());
    const centre = bounds.getCenter(new Vector3());
    const width = Math.max(size.x, size.z);
    const sunPosition = centre.clone().addScaledVector(SUN_DIRECTION, width * SCALE.sunDistance);
    return {
      width,
      page: bounds.min.y - 0.001,
      sun: [sunPosition.x, sunPosition.y, sunPosition.z] as const,
      target: [centre.x, centre.y, centre.z] as const,
      night: [centre.x, bounds.min.y + size.y * NIGHT_LIGHT_HEIGHT, centre.z] as const,
      // How much smaller the model is than the toy scene the light was tuned for.
      lightScale: width / NIGHT_LIGHT.tunedWidth,
    };
  }, [bounds]);
  // Two page shadows, crossfaded: by day with the sun's long shadow, by night without.
  const shadows = useMemo(() => {
    const contact = ground.map(footprint);
    const build = (withSun: boolean) => {
      const layers = [
        { polygons: contact, blur: layout.width * SCALE.groundBlur, strength: 1 },
        ...(withSun
          ? [
              {
                polygons: [castShadow(body, SUN_DIRECTION, body.max.y * CAST_SHADOW.height)],
                blur: layout.width * SCALE.castBlur,
                strength: CAST_SHADOW.strength,
              },
            ]
          : []),
      ];
      // The texture covers the shapes plus room for the blur to fade out.
      const widest = Math.max(...layers.map((layer) => layer.blur));
      const area = areaOf(
        layers.flatMap((layer) => layer.polygons),
        widest * 3,
        new Box3(),
      );
      const texture = createGroundShadowTexture(layers, area);
      const material = new MeshBasicMaterial({
        color: palette.shadow,
        transparent: true,
        depthWrite: false,
        opacity: 0,
        ...(texture && { map: texture }),
      });
      return {
        material,
        texture,
        centre: area.getCenter(new Vector3()),
        size: area.getSize(new Vector3()),
      };
    };
    const day = build(true);
    const night = build(false);
    return {
      day,
      night,
      /** Sets both opacities for the night blend `n` (the day's, × `sun` under clouds). */
      fade: (n: number, sun: number) => {
        if (day.texture) day.material.opacity = GROUND_SHADOW.day * (1 - n) * sun;
        if (night.texture) night.material.opacity = GROUND_SHADOW.night * n;
      },
    };
  }, [ground, body, layout.width, palette.shadow]);
  useEffect(
    () => () => {
      for (const shadow of [shadows.day, shadows.night]) {
        shadow.material.dispose();
        shadow.texture?.dispose();
      }
    },
    [shadows],
  );
  // The sun aims at the diorama's centre.
  const sunTarget = useMemo(() => new Object3D(), []);
  useEffect(() => {
    sunTarget.position.set(...layout.target);
    sunTarget.updateMatrixWorld();
  }, [sunTarget, layout.target]);

  const hemisphere = useRef<HemisphereLight>(null);
  const directional = useRef<DirectionalLight>(null);
  const point = useRef<PointLight>(null);
  useFrame(() => {
    const n = night.current.uNightMix.value;
    const overcast = overcastLight(sceneWeather.clouds);
    const h = hemisphere.current;
    if (h) {
      h.color.lerpColors(palette.sky, palette.moon, n);
      h.groundColor.lerpColors(palette.dayBg, palette.nightGlow, n);
      h.intensity = (1.9 + 0.3 * (1 - overcast.sun)) * (1 - n) + 0.55 * n;
    }
    const d = directional.current;
    if (d) {
      d.color.lerpColors(sleeping ? palette.sky : sun, palette.moon, n);
      d.intensity = 1.2 * overcast.sun * (1 - n) + 0.25 * n;
    }
    const p = point.current;
    if (p) {
      p.color.copy(sleeping ? palette.moon : palette.nightGlow);
      p.intensity = NIGHT_LIGHT.intensity * layout.lightScale * n;
    }
    // The page shadow under the plinth stays; the sun's long one goes with the clouds.
    shadows.fade(n, overcast.shadow * 0.6 + 0.4);
  });

  return (
    <>
      <hemisphereLight ref={hemisphere} />
      <directionalLight ref={directional} position={layout.sun} target={sunTarget} />
      <pointLight
        ref={point}
        intensity={0}
        distance={layout.width * SCALE.nightLightReach}
        decay={1}
        position={layout.night}
      />
      {[shadows.day, shadows.night].map((shadow, i) => (
        <mesh
          key={i}
          position={[shadow.centre.x, layout.page, shadow.centre.z]}
          rotation={[-Math.PI / 2, 0, 0]}
          material={shadow.material}
        >
          <planeGeometry args={[shadow.size.x, shadow.size.z]} />
        </mesh>
      ))}
    </>
  );
}

/** The scene's night blend, eased by the lightmaps (0 day, 1 night). */
export interface NightBlend {
  readonly current: { uNightMix: { value: number } };
}
