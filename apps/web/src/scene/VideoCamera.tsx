import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import { Box3, OrthographicCamera, Spherical, Vector3 } from 'three';
import type { Object3D } from 'three';

import { settleAnimations, showEndCard, videoApi } from '../app/videoMode.ts';
import type { CameraPose } from '../app/videoMode.ts';

/** How far the camera stands from what it looks at (the orthographic view does not change with it). */
const DISTANCE = 20;

interface OrbitLike {
  target: Vector3;
  update(): void;
}

/**
 * Development only (the landing video, app/videoMode.ts): the camera from
 * outside. While a pose is set it is applied every frame, after the app's
 * own camera work (mounted last), so it wins; null hands the camera back,
 * and the app's focus on a plant plays as it does for anyone.
 */
export function VideoCamera({
  home,
  homeDirection,
  fit,
  focus,
  nodes,
}: {
  home: Vector3;
  homeDirection: Vector3;
  fit: number;
  /** Where the app looks at each plant (`cam_focus_<id>`). */
  focus: ReadonlyMap<string, Vector3>;
  /** The model's objects by name (docs/04): the fan, the roof window, the light. */
  nodes: Record<string, Object3D>;
}) {
  const get = useThree((state) => state.get);
  const pose = useRef<CameraPose | null>(null);

  useEffect(() => {
    const api = videoApi();
    const homeSpherical = new Spherical().setFromVector3(homeDirection);
    api.setPose = (next) => {
      pose.current = next;
    };
    api.homePose = () => ({
      target: [home.x, home.y, home.z],
      azimuth: homeSpherical.theta,
      polar: homeSpherical.phi,
      zoom: 1,
    });
    api.getPose = () => {
      const { camera, controls } = get();
      const target = (controls as OrbitLike | null)?.target ?? home;
      const spherical = new Spherical().setFromVector3(camera.position.clone().sub(target));
      const zoom = camera instanceof OrthographicCamera ? camera.zoom / fit : 1;
      return {
        target: [target.x, target.y, target.z],
        azimuth: spherical.theta,
        polar: spherical.phi,
        zoom,
      };
    };
    api.focusOf = (zone) => {
      const point = focus.get(zone);
      return point ? [point.x, point.y, point.z] : null;
    };
    api.centerOf = (name) => {
      const node = nodes[name];
      if (!node) return null;
      const centre = new Box3().setFromObject(node).getCenter(new Vector3());
      return [centre.x, centre.y, centre.z];
    };
    api.settle = settleAnimations;
    api.endCard = showEndCard;
  }, [get, home, homeDirection, fit, focus, nodes]);

  useFrame((state) => {
    const current = pose.current;
    if (!current) return;
    const controls = state.controls as OrbitLike | null;
    const target = new Vector3(...current.target);
    const offset = new Vector3().setFromSphericalCoords(DISTANCE, current.polar, current.azimuth);
    state.camera.position.copy(target).add(offset);
    state.camera.lookAt(target);
    if (state.camera instanceof OrthographicCamera) {
      state.camera.zoom = fit * current.zoom;
      state.camera.updateProjectionMatrix();
    }
    if (controls) {
      controls.target.copy(target);
      controls.update();
    }
  });

  return null;
}
