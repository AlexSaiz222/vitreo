import { useFrame, useThree } from '@react-three/fiber';
import type { ThreeEvent } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import {
  Box3,
  Matrix4,
  OrthographicCamera as ThreeOrthographicCamera,
  Raycaster,
  Vector2,
  Vector3,
} from 'three';
import type { Mesh, Object3D, Scene } from 'three';

import { markerAt, publishAnchors, TAP_SLOP_PX } from '../app/anchors.ts';
import type { PlantOnScreen } from '../app/anchors.ts';
import { useSelection } from '../app/selection.ts';
import { useView } from '../app/view.ts';
import { plantModelName } from './plantNames.ts';
import { ZONES } from './zones.ts';

/** docs/03: a touch target is at least 44 px across, even for a 30 px pot. */
const TARGET_RADIUS_PX = 22;
/** Occlusion is checked every few frames, or at once when the camera moves. */
const OCCLUSION_EVERY_FRAMES = 6;

interface Plant {
  id: string;
  /** The plant as drawn (PlantModel's group), for occlusion. */
  model: Object3D;
  /** World point at the top of the plant, where labels and warnings attach. */
  anchor: Vector3;
  /** World centre and radius of the whole plant (pot and leaves). */
  centre: Vector3;
  radius: number;
  /** The corners of its box, to know what it covers on screen. */
  corners: Vector3[];
}

/** Reused every frame. */
const CORNER = new Vector3();

/** The plants as drawn, once they are all in the scene. */
function measurePlants(scene: Scene): Plant[] | null {
  const plants: Plant[] = [];
  for (const zone of ZONES) {
    const model = scene.getObjectByName(plantModelName(zone.id));
    if (!model) return null;
    model.updateWorldMatrix(true, true);
    // Precise: from the vertices, not the bounding boxes, which also hold
    // the shape keys' extent (wilt) and sit well above the leaves.
    const box = new Box3().setFromObject(model, true);
    const centre = box.getCenter(new Vector3());
    plants.push({
      id: zone.id,
      model,
      anchor: new Vector3(centre.x, box.max.y, centre.z),
      centre,
      radius: box.getSize(new Vector3()).length() / 2,
      corners: [0, 1, 2, 3, 4, 5, 6, 7].map(
        (i) =>
          new Vector3(
            i & 1 ? box.max.x : box.min.x,
            i & 2 ? box.max.y : box.min.y,
            i & 4 ? box.max.z : box.min.z,
          ),
      ),
    });
  }
  return plants;
}

/**
 * Follows the plants on screen for the HUD (labels, anchored warnings,
 * keyboard targets: app/anchors.ts) and gives each one a touch zone.
 *
 * The touch zones are invisible spheres in the scene, at least 44 px across
 * at any zoom. Being part of the 3D scene (not HTML on top of it), they never
 * take a drag away from the camera: OrbitControls still gets every pointer
 * event, and a press that moved is not a tap.
 */
export function PlantTracker() {
  const open = useSelection((state) => state.open);
  const setHovered = useView((state) => state.setHovered);
  const plants = useRef<Plant[] | null>(null);
  const spheres = useRef(new Map<string, Mesh>());
  const occluded = useRef(new Map<string, boolean>());
  const lastCamera = useRef(new Matrix4());
  const frame = useRef(0);
  const raycaster = useMemo(() => new Raycaster(), []);
  const canvas = useThree((state) => state.gl.domElement);

  // A tap on a warning or label over empty background. The scene reports
  // missed taps only if the pointer did not move at all (2 px); a finger
  // always moves a little, so taps up to TAP_SLOP_PX are caught here.
  useEffect(() => {
    let down: { x: number; y: number } | null = null;
    const onDown = (event: PointerEvent) => {
      down = { x: event.clientX, y: event.clientY };
    };
    const onUp = (event: PointerEvent) => {
      if (!down) return;
      const moved = Math.hypot(event.clientX - down.x, event.clientY - down.y);
      down = null;
      if (moved > TAP_SLOP_PX) return;
      const zone = markerAt(event.clientX, event.clientY);
      if (zone) open(zone);
    };
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointerup', onUp);
    return () => {
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointerup', onUp);
    };
  }, [canvas, open]);

  useFrame((state) => {
    const { camera, size, scene } = state;
    plants.current ??= measurePlants(scene);
    const list = plants.current;
    if (!list) return;
    frame.current += 1;
    const moved = !lastCamera.current.equals(camera.matrixWorld);
    lastCamera.current.copy(camera.matrixWorld);

    // Pixels per world unit at a point: the orthographic camera maps one
    // unit to `zoom` pixels; a perspective one depends on the distance.
    const pixelsPerUnit = (point: Vector3) => {
      if (camera instanceof ThreeOrthographicCamera) return camera.zoom;
      const distance = camera.position.distanceTo(point);
      const fov = 'fov' in camera ? camera.fov : 22;
      return size.height / (2 * distance * Math.tan((fov * Math.PI) / 360));
    };

    for (const plant of list) {
      const sphere = spheres.current.get(plant.id);
      if (!sphere) continue;
      sphere.position.copy(plant.centre);
      sphere.scale.setScalar(
        Math.max(plant.radius, TARGET_RADIUS_PX / pixelsPerUnit(plant.centre)),
      );
    }

    // Another plant between the camera and this one's anchor (camera rotated).
    if (moved || frame.current % OCCLUSION_EVERY_FRAMES === 0) {
      for (const plant of list) {
        const ndc = plant.anchor.clone().project(camera);
        raycaster.setFromCamera(new Vector2(ndc.x, ndc.y), camera);
        const toAnchor = raycaster.ray.origin.distanceTo(plant.anchor);
        const others = list.filter((other) => other.id !== plant.id).map((other) => other.model);
        const hit = raycaster.intersectObjects(others, true)[0];
        occluded.current.set(plant.id, hit !== undefined && hit.distance < toAnchor - 0.01);
      }
    }

    const onScreen = new Map<string, PlantOnScreen>();
    for (const plant of list) {
      const ndc = plant.anchor.clone().project(camera);
      let left = Infinity;
      let top = Infinity;
      let right = -Infinity;
      let bottom = -Infinity;
      for (const corner of plant.corners) {
        const c = CORNER.copy(corner).project(camera);
        const x = ((c.x + 1) / 2) * size.width;
        const y = ((1 - c.y) / 2) * size.height;
        left = Math.min(left, x);
        right = Math.max(right, x);
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
      }
      onScreen.set(plant.id, {
        body: { x: left, y: top, w: right - left, h: bottom - top },
        x: ((ndc.x + 1) / 2) * size.width,
        y: ((1 - ndc.y) / 2) * size.height,
        inFront: ndc.z < 1,
        occluded: occluded.current.get(plant.id) ?? false,
      });
    }
    publishAnchors({ width: size.width, height: size.height, plants: onScreen });
  });

  return (
    <>
      {ZONES.map((zone) => (
        <mesh
          key={zone.id}
          name={`plant-target-${zone.id}`}
          ref={(mesh: Mesh | null) => {
            if (mesh) spheres.current.set(zone.id, mesh);
            else spheres.current.delete(zone.id);
          }}
          // Raycast only: never drawn (no draw call).
          visible={false}
          onClick={(event: ThreeEvent<MouseEvent>) => {
            if (event.delta > TAP_SLOP_PX) return;
            event.stopPropagation();
            // A warning drawn over a neighbour wins: it is what was tapped.
            open(markerAt(event.nativeEvent.clientX, event.nativeEvent.clientY) ?? zone.id);
          }}
          onPointerOver={(event: ThreeEvent<PointerEvent>) => {
            event.stopPropagation();
            document.body.style.cursor = 'pointer';
            setHovered(zone.id);
          }}
          onPointerOut={() => {
            document.body.style.cursor = '';
            setHovered(null);
          }}
        >
          <sphereGeometry args={[1, 12, 8]} />
        </mesh>
      ))}
    </>
  );
}
