import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { Color } from 'three';
import type { Mesh, MeshLambertMaterial, MeshPhysicalMaterial } from 'three';
import type { Object3D, WebGLProgramParametersWithUniforms } from 'three';

import { bakedLight } from '../lightmaps.ts';
import type { Lightmaps } from '../lightmaps.ts';
import { plantModelName } from '../plantNames.ts';
import { usePotLook } from '../potLook.ts';
import type { PotPalette } from '../potLook.ts';
import { useReducedMotion } from '../useReducedMotion.ts';
import { sceneWind } from '../atmosphere.ts';
import { swayWith } from '../wind.ts';
import type { Wind } from '../wind.ts';
import type { ZoneLayout } from '../zones.ts';
import { nodeOf } from './diorama.ts';
import { retintLeaves } from './leafTones.ts';

/** How far a leaf tip sways in the wind, in metres of the model (docs/02: slow, organic). */
const SWAY_METRES = 0.0025;

/** The leaf material is white: each leaf's tone comes from its vertex colours. */
const WHITE = new Color('#ffffff');

function isMesh(object: Object3D): object is Mesh {
  return (object as Partial<Mesh>).isMesh === true;
}

/** The leaf meshes of a foliage node: itself, or one child per Blender material. */
function leavesOf(foliage: Object3D): Mesh[] {
  return isMesh(foliage) ? [foliage] : foliage.children.filter(isMesh);
}

/**
 * A plant of the diorama (docs/04): `plant_<id>` with `pot_<id>`, `soil_<id>`
 * and `foliage_<id>`, where the .glb puts them (node transforms, real size,
 * D57). Geometry comes from the .glb; colours from the palette tokens (the
 * leaf tones of COLOR_0 are mapped onto the leaf tokens). Connected to the
 * store: soil colour from moisture, the "wilt" shape key from the threshold,
 * and the leaves sway with `_WIND` (not with reduced motion).
 */
export function PlantModel({
  zone,
  nodes,
  palette,
  lightmaps,
  night,
}: {
  zone: ZoneLayout;
  nodes: Record<string, Object3D>;
  palette: PotPalette;
  lightmaps: Lightmaps;
  night: boolean;
}) {
  const root = nodeOf(nodes, `plant_${zone.id}`);
  const pot = nodeOf(nodes, `pot_${zone.id}`) as Mesh;
  const soilNode = nodeOf(nodes, `soil_${zone.id}`) as Mesh;
  const foliage = nodeOf(nodes, `foliage_${zone.id}`);
  const leaves = useMemo(
    () =>
      leavesOf(foliage).map((mesh) => ({
        mesh,
        geometry: retintLeaves(mesh.geometry, [
          palette.leafDeep,
          palette.leafMid,
          palette.leafNew,
          palette.leafLight,
          palette.flowerWhite,
          palette.flowerHeart,
          palette.fruit,
          palette.fruitGreen,
          palette.flowerChives,
          palette.stake,
        ]),
      })),
    [
      foliage,
      palette.leafDeep,
      palette.leafMid,
      palette.leafNew,
      palette.leafLight,
      palette.flowerWhite,
      palette.flowerHeart,
      palette.fruit,
      palette.fruitGreen,
      palette.flowerChives,
      palette.stake,
    ],
  );
  useEffect(
    () => () => {
      for (const { mesh, geometry } of leaves) {
        if (geometry !== mesh.geometry) geometry.dispose();
      }
    },
    [leaves],
  );
  const reducedMotion = useReducedMotion();

  // Sway is set in model metres; the leaf geometry carries its own scale.
  // A single-material foliage is itself the mesh: its scale counts once.
  const leaf = leaves[0]?.mesh;
  const leafScale = foliage.scale.x * (leaf && leaf !== foliage ? leaf.scale.x : 1);
  const wind = useRef<Wind>({
    uTime: { value: 0 },
    uSway: { value: SWAY_METRES / leafScale },
    uPhase: { value: (root.position.x * 7 + root.position.z * 11) * Math.PI },
  });

  const terracotta = useRef<MeshLambertMaterial>(null);
  const soil = useRef<MeshPhysicalMaterial>(null);
  const leafMaterials = useRef<(MeshLambertMaterial | null)[]>([]);
  const leafMeshes = useRef<(Mesh | null)[]>([]);

  const initialSoil = usePotLook(zone, palette, {
    materials: () => ({
      soil: soil.current,
      faded: [
        [terracotta.current, palette.terracotta],
        ...leaves.map(
          (_, index) =>
            [leafMaterials.current[index], WHITE] as [
              MeshLambertMaterial | null | undefined,
              Color,
            ],
        ),
      ],
    }),
    night,
    onWilt: (w) => {
      for (const mesh of leafMeshes.current) {
        const index = mesh?.morphTargetDictionary?.['wilt'];
        if (mesh?.morphTargetInfluences && index !== undefined) {
          mesh.morphTargetInfluences[index] = w;
        }
      }
    },
  });

  useFrame(() => {
    // The wind from the data (A9: fan and window, scene/Atmosphere); it stops
    // with reduced motion (docs/02).
    wind.current.uTime.value = reducedMotion ? 0 : sceneWind.time;
    wind.current.uSway.value = (SWAY_METRES / leafScale) * sceneWind.strength;
  });

  // Pot and soil baked in Blender (extra "lightmap"): lit only by the
  // lightmaps (docs/04, part 5).
  const baked = (node: Object3D) =>
    node.userData['lightmap'] === true
      ? {
          lightMap: lightmaps.day,
          onBeforeCompile: (shader: WebGLProgramParametersWithUniforms) => {
            bakedLight(lightmaps.uniforms)(shader);
          },
          customProgramCacheKey: () => 'vitreo-baked',
        }
      : {};

  return (
    // Taps are caught by PlantTracker's touch zones (at least 44 px, A2).
    <group
      name={plantModelName(zone.id)}
      position={root.position}
      quaternion={root.quaternion}
      scale={root.scale}
    >
      <mesh
        geometry={pot.geometry}
        position={pot.position}
        quaternion={pot.quaternion}
        scale={pot.scale}
      >
        <meshLambertMaterial ref={terracotta} color={palette.terracotta} {...baked(pot)} />
      </mesh>
      <mesh
        geometry={soilNode.geometry}
        position={soilNode.position}
        quaternion={soilNode.quaternion}
        scale={soilNode.scale}
      >
        {/* The wet sheen (clearcoat) still catches the sun: it is data. */}
        <meshPhysicalMaterial
          ref={soil}
          color={initialSoil}
          roughness={1}
          clearcoat={0}
          clearcoatRoughness={0.25}
          {...baked(soilNode)}
        />
      </mesh>
      <group position={foliage.position} quaternion={foliage.quaternion} scale={foliage.scale}>
        {leaves.map(({ mesh, geometry }, index) => {
          const own = mesh !== foliage;
          return (
            <mesh
              key={mesh.uuid}
              ref={(leaf: Mesh | null) => {
                leafMeshes.current[index] = leaf;
              }}
              geometry={geometry}
              position={own ? mesh.position : [0, 0, 0]}
              quaternion={own ? mesh.quaternion : [0, 0, 0, 1]}
              scale={own ? mesh.scale : 1}
              // R3F builds the mesh before its geometry, so the shape keys are passed on.
              morphTargetDictionary={mesh.morphTargetDictionary ?? {}}
              morphTargetInfluences={[0]}
            >
              <meshLambertMaterial
                ref={(material: MeshLambertMaterial | null) => {
                  leafMaterials.current[index] = material;
                }}
                color={WHITE}
                vertexColors
                onBeforeCompile={(shader: WebGLProgramParametersWithUniforms) => {
                  swayWith(wind.current)(shader);
                }}
                customProgramCacheKey={() => 'vitreo-leaf-wind'}
              />
            </mesh>
          );
        })}
      </group>
    </group>
  );
}
