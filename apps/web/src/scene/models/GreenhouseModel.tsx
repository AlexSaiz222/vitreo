import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Box3, Color, MeshLambertMaterial, Vector3 } from 'three';
import type { BufferGeometry, Group, Material, Mesh, Object3D, PointLight } from 'three';
import type { WebGLProgramParametersWithUniforms } from 'three';

import { useEffectiveQuality } from '../../app/settings.ts';
import { useFreshness } from '../../data/greenhouse.ts';
import { sceneReading } from '../../data/sceneReading.ts';
import { useReplayGap, useShownGrowLight } from '../../data/shown.ts';
import { createGlassMaterial, GLASS, setGlass, waterNoise } from '../../shaders/glass.ts';
import {
  condensationFor,
  decorSwayFor,
  overcastLight,
  sceneWeather,
  SUN_DIRECTION,
} from '../atmosphere.ts';
import {
  createPlinthMaterial,
  createSandTexture,
  wetGround,
  withPlanarUv,
} from '../dioramaMaterials.ts';
import type { WetUniforms } from '../dioramaMaterials.ts';
import { bakedLight, probeLight } from '../lightmaps.ts';
import type { LightProbe, Lightmaps } from '../lightmaps.ts';
import type { ScenePalette } from '../palette.ts';
import { useReducedMotion } from '../useReducedMotion.ts';
import { swayWith } from '../wind.ts';
import type { Wind } from '../wind.ts';
import { nodeOf } from './diorama.ts';

/** Everything but the plants, by node name (docs/04, part 3). */
const PARTS = [
  // structure
  'base',
  'gravel',
  'path',
  'steps',
  'floor_main',
  'frame_main',
  'frame_details',
  'gutter',
  'glass_main',
  'door',
  'vent_window',
  // devices
  'tank',
  'tank_water',
  'tank_hose',
  'pump',
  'grow_light',
  'fan',
  'fan_blades',
  'sensor_box',
  'vent_servo',
  'cables',
  // decor
  'decor_ground',
  'decor_plants',
] as const;
type PartName = (typeof PARTS)[number];

/** One sand texture repeat every this many metres of the tray. */
const SAND_TILE = 0.34;
/** The roof vent follows the servo softly; with reduced motion it jumps. */
const VENT_EASE_SECONDS = 0.5;
/** The fan turns slowly enough to read as calm (1.5 turns per second). */
const FAN_SPEED = Math.PI * 3;
const FAN_EASE_SECONDS = 0.6;
/** The water in the tank gauge follows the level softly. */
const LEVEL_EASE_SECONDS = 0.8;
/** Condensation comes and goes slowly, as it does on real glass. */
const MIST_EASE_SECONDS = 6;
/** How far a decor leaf tip sways, in metres (outside, a little more than inside). */
const DECOR_SWAY_METRES = 0.003;
/** Emission of the grow light strip when on, and of the sensor box light. */
const GLOW = { strip: 1.4, led: 0.9 } as const;
/**
 * The light the grow light casts when on: the strip faces down, so from the
 * camera its state reads in the warm light on the plants and the floor.
 * Always there (intensity 0 when off), so switching never recompiles shaders.
 */
const LAMP = { intensity: 0.24, reach: 1, below: 0.03, easeSeconds: 0.3 } as const;

/** What gets wet outside, by material name; small puddles only on the path (D120). */
const WET_SURFACES: Partial<Record<string, { puddles: boolean; wet?: false }>> = {
  plinth: { puddles: false },
  tray: { puddles: false },
  path: { puddles: true },
  // The bars hold a line of snow on top (D136), but shed the rain.
  frame: { puddles: false, wet: false },
};

/** The program of a ground that can be wet or snowy, for the shader cache. */
const wetKey = (wet: { puddles: boolean; wet?: false } | undefined) =>
  wet ? (wet.wet === false ? '-snow' : wet.puddles ? '-puddles' : '-wet') : '';

function isMesh(object: Object3D): object is Mesh {
  return (object as Partial<Mesh>).isMesh === true;
}

function materialName(mesh: Mesh): string {
  const material: Material | Material[] = mesh.material;
  return (Array.isArray(material) ? material[0]?.name : material.name) ?? '';
}

interface Look {
  /**
   * `baked`: the node (or one above it) carries a lightmap (docs/04, part 5).
   * `probe`: the light probe of the nearest node (itself or above) that has
   * one, for parts that are not baked (D68).
   */
  materialFor: (mesh: Mesh, baked: boolean, probe: string | undefined) => Material;
  /** Node names that have a light probe. */
  probes: ReadonlySet<string>;
  /** A replacement geometry for a mesh (e.g. with texture coordinates). */
  geometryFor?: (mesh: Mesh) => BufferGeometry | undefined;
  onMesh?: (source: Mesh, built: Mesh | null) => void;
  onGroup?: (source: Object3D, built: Group | null) => void;
}

function setWetGround(
  ground: WetUniforms,
  rings: boolean,
  night: number,
  palette: ScenePalette,
): void {
  ground.uWet.value = sceneWeather.wet;
  ground.uSnowCover.value = sceneWeather.snowCover;
  ground.uWetRain.value = rings ? sceneWeather.rain : 0;
  ground.uWetTime.value = sceneWeather.time;
  // The moon is a token for light on glass; on the ground it is much dimmer.
  ground.uWetSky.value.lerpColors(palette.sky, palette.moon, night).multiplyScalar(1 - 0.7 * night);
  // Snow under the moon stays pale (D136): the night lightmap alone left it
  // as dark as the ground.
  ground.uSnowNight.value.copy(palette.moon).multiplyScalar(0.3 * night);
}

/**
 * A node of the .glb and everything under it, as React elements, each with
 * its own transform (empties such as the door's hinge included). Shape keys
 * are passed on: R3F builds the mesh before its geometry.
 */
function Part({
  node,
  look,
  baked = false,
  probe,
}: {
  node: Object3D;
  look: Look;
  baked?: boolean;
  probe?: string | undefined;
}) {
  // Blender marks baked objects with the extra "lightmap"; their meshes inherit it.
  const isBaked = baked || node.userData['lightmap'] === true;
  const ownProbe = look.probes.has(node.name) ? node.name : probe;
  const mesh = isMesh(node) ? node : null;
  const material = mesh ? look.materialFor(mesh, isBaked, ownProbe) : null;
  const targets = mesh?.morphTargetDictionary;
  return (
    <group
      ref={(group: Group | null) => {
        look.onGroup?.(node, group);
      }}
      position={node.position}
      quaternion={node.quaternion}
      scale={node.scale}
    >
      {mesh && material && (
        <mesh
          ref={(built: Mesh | null) => {
            look.onMesh?.(mesh, built);
          }}
          geometry={look.geometryFor?.(mesh) ?? mesh.geometry}
          material={material}
          {...(targets && {
            morphTargetDictionary: targets,
            morphTargetInfluences: Object.keys(targets).map(() => 0),
          })}
        />
      )}
      {node.children.map((child) => (
        <Part key={child.uuid} node={child} look={look} baked={isBaked} probe={ownProbe} />
      ))}
    </group>
  );
}

/**
 * The (probe, material) pairs the parts that are not baked use, so their
 * probe-lit materials can be made once.
 */
function probedPairs(
  roots: readonly Object3D[],
  probes: ReadonlyMap<string, LightProbe>,
): Map<string, { probe: LightProbe; material: string }> {
  const pairs = new Map<string, { probe: LightProbe; material: string }>();
  const visit = (node: Object3D, baked: boolean, inherited: string | undefined) => {
    const isBaked = baked || node.userData['lightmap'] === true;
    const name = probes.has(node.name) ? node.name : inherited;
    const probe = name === undefined ? undefined : probes.get(name);
    if (isMesh(node) && !isBaked && name !== undefined && probe) {
      const material = materialName(node);
      pairs.set(`${name}/${material}`, { probe, material });
    }
    for (const child of node.children) visit(child, isBaked, name);
  };
  for (const root of roots) visit(root, false, undefined);
  return pairs;
}

/**
 * The diorama from vitreo.glb (docs/04) except the plants: structure,
 * devices and decor, at real size and where Blender put them. Colours from
 * the palette tokens by Blender material name; decor keeps its vertex
 * colours (tinted by `--scene-decor`). Connected to the store:
 * - the roof vent opens with `actuators.vent` (shape key "open");
 * - the grow light strip glows with `actuators.growLight`;
 * - the fan blades turn with `actuators.fan` (not with reduced motion);
 * - the water in the tank gauge follows `tank.level` (hidden when unknown);
 * - the sensor box light is on while data is live.
 * Parts baked in Blender (extra "lightmap") are lit only by their lightmaps;
 * the other solid parts by the light probe around them (D68), so they match.
 */
export function GreenhouseModel({
  nodes,
  palette,
  body,
  lightmaps,
}: {
  nodes: Record<string, Object3D>;
  palette: ScenePalette;
  /** The greenhouse itself: where its glass starts and how tall it is. */
  body: Box3;
  lightmaps: Lightmaps;
}) {
  const reducedMotion = useReducedMotion();
  const quality = useEffectiveQuality();
  const growLight = useShownGrowLight();
  const replayGap = useReplayGap();
  const live = useFreshness().kind === 'live' && !replayGap;

  // Vent, fan and tank are read every frame (sceneReading), live or rewound.
  const opening = useRef(sceneReading.vent());
  const ventMeshes = useRef(new Map<string, Mesh>());
  const groups = useRef(new Map<string, Group>());
  const fan = useRef({ speed: 0, angle: 0 });
  const water = useRef(sceneReading.tank() ?? 0);
  const lamp = useRef<PointLight>(null);
  const lampOn = useRef(growLight ? 1 : 0);
  const mist = useRef(condensationFor(sceneReading.rh()));
  const decorTime = useRef(0);
  const [wetUniforms] = useState<WetUniforms>(() => ({
    uWet: { value: 0 },
    uWetRain: { value: 0 },
    uWetTime: { value: 0 },
    uWetSky: { value: palette.sky.clone() },
    uSnowCover: { value: 0 },
    uSnowColor: { value: palette.snow.clone() },
    uSnowNight: { value: new Color() },
    uWetNoise: { value: waterNoise() },
  }));
  const decorWind = useRef<Wind>({
    uTime: { value: 0 },
    uSway: { value: 0 },
    uPhase: { value: 0 },
  });

  const gravel = nodeOf(nodes, 'gravel');
  const base = nodeOf(nodes, 'base');
  const tray = useMemo(() => {
    const meshes = isMesh(gravel) ? [gravel] : gravel.children.filter(isMesh);
    return new Map(
      meshes.map((mesh) => [mesh, withPlanarUv(mesh.geometry, mesh.matrixWorld, SAND_TILE)]),
    );
  }, [gravel]);
  const plinthTop = useMemo(() => new Box3().setFromObject(base).max.y, [base]);
  const growLightNode = nodeOf(nodes, 'grow_light');
  const lampPosition = useMemo(() => {
    const at = growLightNode.getWorldPosition(new Vector3());
    return [at.x, at.y - LAMP.below, at.z] as const;
  }, [growLightNode]);
  // Decor sway is set in metres; its mesh carries the quantisation scale.
  const decorScale = nodeOf(nodes, 'decor_plants').scale.x;

  const { uniforms: lightmapUniforms, day: dayLightmap, probes } = lightmaps;
  // Probe-lit parts: everything not baked but the windy decor (own shader).
  const probeRoots = PARTS.filter((name) => name !== 'decor_plants').map((name) =>
    nodeOf(nodes, name),
  );
  const materials = useMemo(() => {
    // Matte clay (no specular, ref-03). No night glow: the night atlas sets
    // how the baked frame looks at night, and the parts lit live must match it.
    const lambert = (color: Color, extra = {}) => new MeshLambertMaterial({ color, ...extra });
    const sand = createSandTexture(palette.tray, 1);
    const decorWindy = lambert(palette.decor, { vertexColors: true });
    decorWindy.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
      swayWith(decorWind.current)(shader);
    };
    decorWindy.customProgramCacheKey = () => 'vitreo-decor-wind';
    const surfaces = {
      plinth: createPlinthMaterial(palette.plinth, plinthTop),
      tray: new MeshLambertMaterial(sand ? { map: sand } : { color: palette.tray }),
      path: lambert(palette.path),
      floor: lambert(palette.frame),
      frame: lambert(palette.frame),
      // Built with the day look; every frame blends it towards the night
      // and adds the condensation (setGlass, A9).
      glass: createGlassMaterial({
        tint: palette.glass,
        sky: palette.sky,
        page: palette.dayBg,
        glow: palette.nightGlow,
        glowAmount: 0,
        ...GLASS.day,
      }),
      device: lambert(palette.device),
      device_dark: lambert(palette.deviceDark),
      fan_back: lambert(palette.fanBack),
      fan_blade: lambert(palette.fanBlade),
      hardware: lambert(palette.hardware),
      gasket: lambert(palette.gasket),
      water: lambert(palette.water),
      decor: lambert(palette.decor, { vertexColors: true }),
    };
    // Baked variants: the same colour, lit only by the lightmaps (read when
    // the shader compiles). No night glow: the night atlas already has the
    // light from inside. Glass stays as it is.
    const patch = (shader: WebGLProgramParametersWithUniforms) => {
      bakedLight(lightmapUniforms)(shader);
    };
    const baked: Partial<Record<string, MeshLambertMaterial>> = {};
    for (const [name, material] of Object.entries(surfaces)) {
      if (!(material instanceof MeshLambertMaterial)) continue;
      const variant = material.clone();
      variant.lightMap = dayLightmap;
      variant.emissiveIntensity = 0;
      const wet = WET_SURFACES[name];
      variant.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
        patch(shader);
        if (wet) wetGround(wetUniforms, wet.puddles, wet.wet !== false)(shader);
      };
      variant.customProgramCacheKey = () => `vitreo-baked${wetKey(wet)}`;
      baked[name] = variant;
    }
    // Probe-lit variants, one per (probe, material) actually used.
    const probed = new Map<string, MeshLambertMaterial>();
    const lambertByName: Partial<Record<string, Material>> = surfaces;
    for (const [key, { probe, material: name }] of probedPairs(probeRoots, probes)) {
      const material = lambertByName[name];
      if (!(material instanceof MeshLambertMaterial)) continue;
      const variant = material.clone();
      variant.emissiveIntensity = 0;
      const wet = WET_SURFACES[name];
      variant.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
        probeLight(lightmapUniforms, probe)(shader);
        if (wet) wetGround(wetUniforms, wet.puddles, wet.wet !== false)(shader);
      };
      variant.customProgramCacheKey = () => `vitreo-probe${wetKey(wet)}`;
      probed.set(key, variant);
    }
    return { surfaces, decorWindy, sand, baked, probed };
    // probeRoots come from `nodes`, which this already depends on through plinthTop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [palette, plinthTop, lightmapUniforms, dayLightmap, probes, wetUniforms]);
  // Switched by the store: their own materials, rebuilt when they change.
  const strip = useMemo(
    () =>
      new MeshLambertMaterial({
        color: palette.lightStrip,
        emissive: palette.nightGlow,
        emissiveIntensity: growLight ? GLOW.strip : 0,
      }),
    [palette.lightStrip, palette.nightGlow, growLight],
  );
  const led = useMemo(
    () =>
      new MeshLambertMaterial({
        color: palette.led,
        emissive: palette.led,
        emissiveIntensity: live ? GLOW.led : 0,
      }),
    [palette.led, live],
  );
  useEffect(
    () => () => {
      for (const material of Object.values(materials.surfaces)) material.dispose();
      for (const material of Object.values(materials.baked)) material?.dispose();
      for (const material of materials.probed.values()) material.dispose();
      materials.decorWindy.dispose();
      materials.sand?.dispose();
    },
    [materials],
  );
  useEffect(
    () => () => {
      strip.dispose();
      led.dispose();
    },
    [strip, led],
  );

  useEffect(
    () => () => {
      for (const geometry of tray.values()) geometry.dispose();
    },
    [tray],
  );

  const { surfaces, baked, probed } = materials;
  const byName: Partial<Record<string, Material>> = { ...surfaces, light_strip: strip, led };
  // By Blender material name; anything unexpected is drawn like the frame
  // (`pnpm models` refuses unknown names, so this should not happen).
  const materialFor = (mesh: Mesh, isBaked: boolean, probe: string | undefined) => {
    const name = materialName(mesh);
    if (isBaked) return baked[name] ?? byName[name] ?? surfaces.frame;
    return (probe ? probed.get(`${probe}/${name}`) : undefined) ?? byName[name] ?? surfaces.frame;
  };
  const probeNames = new Set(probes.keys());

  const lookOf = (name: PartName): Look => {
    switch (name) {
      case 'gravel':
        return {
          probes: probeNames,
          materialFor: (_, isBaked) => (isBaked ? baked['tray'] : undefined) ?? surfaces.tray,
          geometryFor: (m) => tray.get(m),
        };
      case 'decor_plants':
        return { probes: probeNames, materialFor: () => materials.decorWindy };
      case 'vent_window':
        return {
          probes: probeNames,
          materialFor,
          onMesh: (source, built) => {
            if (built) ventMeshes.current.set(source.uuid, built);
            else ventMeshes.current.delete(source.uuid);
          },
        };
      case 'fan_blades':
      case 'tank_water':
        return {
          probes: probeNames,
          materialFor,
          onGroup: (source, built) => {
            // Only the part's own node: an empty on its origin (docs/04).
            if (source.name !== name) return;
            if (built) groups.current.set(name, built);
            else groups.current.delete(name);
          },
        };
      default:
        return { probes: probeNames, materialFor };
    }
  };

  useFrame((_, delta) => {
    const soft = (seconds: number) => (reducedMotion ? 1 : 1 - Math.exp(-delta / seconds));

    opening.current += (sceneReading.vent() - opening.current) * soft(VENT_EASE_SECONDS);
    for (const mesh of ventMeshes.current.values()) {
      const index = mesh.morphTargetDictionary?.['open'];
      if (mesh.morphTargetInfluences && index !== undefined) {
        mesh.morphTargetInfluences[index] = opening.current;
      }
    }

    // Decorative motion stops with reduced motion (docs/02); the dock still
    // says whether the fan is on.
    const blades = groups.current.get('fan_blades');
    const target = sceneReading.fan() && !reducedMotion ? FAN_SPEED : 0;
    fan.current.speed += (target - fan.current.speed) * soft(FAN_EASE_SECONDS);
    fan.current.angle = (fan.current.angle + fan.current.speed * delta) % (Math.PI * 2);
    if (blades) blades.rotation.x = fan.current.angle;

    const tank = groups.current.get('tank_water');
    if (tank) {
      // Unknown (broken sensor, no data, a gap) is not "empty": the water is
      // hidden and the status line says why.
      const level = sceneReading.tank();
      tank.visible = level !== null;
      water.current += ((level ?? 0) - water.current) * soft(LEVEL_EASE_SECONDS);
      // Never quite zero: a zero scale breaks the normals.
      tank.scale.y = Math.max(water.current, 0.001);
    }

    // Light changes carry information: they fade even with reduced motion.
    lampOn.current +=
      ((growLight ? 1 : 0) - lampOn.current) * (1 - Math.exp(-delta / LAMP.easeSeconds));
    if (lamp.current) lamp.current.intensity = LAMP.intensity * lampOn.current;

    // The glass: day ↔ night through twilight, and condensation from the
    // humidity (A9). Information, so it fades even with reduced motion.
    mist.current +=
      (condensationFor(sceneReading.rh()) - mist.current) *
      (1 - Math.exp(-delta / MIST_EASE_SECONDS));
    const nightMix = lightmapUniforms.current.uNightMix.value;
    setGlass(materials.surfaces.glass, {
      night: nightMix,
      condensation: mist.current,
      sky: palette.sky,
      moon: palette.moon,
      page: { day: palette.dayBg, night: palette.nightBg },
      fog: palette.condensation,
      floor: body.min.y,
      height: body.max.y - body.min.y,
      // Drops stay on the glass while everything is still wet.
      rain: Math.max(sceneWeather.rain, sceneWeather.wet * 0.45),
      rainColor: palette.rain,
      time: sceneWeather.time,
      runs: quality === 'high',
      sunDirection: SUN_DIRECTION,
      sun: overcastLight(sceneWeather.clouds).sun * (1 - nightMix) + 0.35 * nightMix,
      snow: sceneWeather.snowCover,
      snowColor: palette.snow,
    });

    // The ground outside, wet by the rain and drying by the gauge (D120).
    setWetGround(wetUniforms, quality === 'high', nightMix, palette);

    // The plants outside sway with the wind outside (A10).
    const sway = decorSwayFor(sceneWeather.wind);
    decorTime.current = reducedMotion ? 0 : decorTime.current + delta * sway.speed;
    decorWind.current.uTime.value = decorTime.current;
    decorWind.current.uSway.value = (DECOR_SWAY_METRES / decorScale) * sway.strength;
  });

  return (
    <group>
      {PARTS.map((name) => (
        <Part key={name} node={nodeOf(nodes, name)} look={lookOf(name)} />
      ))}
      <pointLight
        ref={lamp}
        position={lampPosition}
        color={palette.nightGlow}
        intensity={0}
        distance={LAMP.reach}
        decay={1}
      />
    </group>
  );
}
