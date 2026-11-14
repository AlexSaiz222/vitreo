import { useGLTF } from '@react-three/drei';
import { useMemo } from 'react';
import { Box3, Vector3 } from 'three';
import type { Object3D } from 'three';

import { ZONES } from '../zones.ts';

/**
 * The whole diorama, modelled in Blender at real size (D57) from
 * assets/blender/vitreo.blend and optimised by `pnpm models` (docs/04).
 */
export const DIORAMA_URL = '/models/vitreo.glb';

/** A named node of the model; a missing one is an export error (docs/04, part 3). */
export function nodeOf(nodes: Record<string, Object3D>, name: string): Object3D {
  const node = nodes[name];
  if (!node) throw new Error(`The model has no "${name}" node (docs/04, naming contract)`);
  return node;
}

export interface Diorama {
  nodes: Record<string, Object3D>;
  /** Everything: plinth, steps and roof (for framing and lighting). */
  bounds: Box3;
  /** What stands on the page (plinth, steps), for the shadow beneath. */
  ground: readonly Box3[];
  /** The greenhouse itself (its frame), for its long shadow on the page. */
  body: Box3;
  /** All the plants together (for framing them beside the detail sheet). */
  plants: Box3;
  /** Where the camera looks at rest (empty `cam_home`). */
  home: Vector3;
  /** Where the camera looks when a plant is chosen (empties `cam_focus_<id>`). */
  focus: ReadonlyMap<string, Vector3>;
}

/** Parts of the model that stand on the page. */
const GROUND = ['base', 'steps'];

const worldPosition = (node: Object3D) => node.getWorldPosition(new Vector3());

/** Loads the diorama (suspends until it is ready) and reads its empties. */
export function useDiorama(): Diorama {
  const { nodes, scene } = useGLTF(DIORAMA_URL, false, true);
  return useMemo(() => {
    scene.updateWorldMatrix(true, true);
    const plants = new Box3();
    const focus = new Map<string, Vector3>();
    for (const zone of ZONES) {
      plants.union(new Box3().setFromObject(nodeOf(nodes, `plant_${zone.id}`)));
      focus.set(zone.id, worldPosition(nodeOf(nodes, `cam_focus_${zone.id}`)));
    }
    return {
      nodes,
      bounds: new Box3().setFromObject(scene),
      ground: GROUND.map((name) => new Box3().setFromObject(nodeOf(nodes, name))),
      body: new Box3().setFromObject(nodeOf(nodes, 'frame_main')),
      plants,
      home: worldPosition(nodeOf(nodes, 'cam_home')),
      focus,
    };
  }, [nodes, scene]);
}

useGLTF.preload(DIORAMA_URL, false, true);
