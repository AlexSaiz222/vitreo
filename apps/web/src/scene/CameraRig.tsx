import { OrbitControls, OrthographicCamera, PerspectiveCamera } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { Box3, OrthographicCamera as ThreeOrthographicCamera, Vector3 } from 'three';

import { useSelection } from '../app/selection.ts';
import { inVideoMode } from '../app/videoMode.ts';
import { useView } from '../app/view.ts';
import { viewOptions } from '../app/viewOptions.ts';
import type { CameraKind } from '../app/viewOptions.ts';
import { projectedSize, viewDirection } from './cameraFit.ts';
import type { Diorama } from './models/diorama.ts';
import { useReducedMotion } from './useReducedMotion.ts';
import { VideoCamera } from './VideoCamera.tsx';

const deg = (value: number) => (value * Math.PI) / 180;

/** On-screen size of something, in world units. */
interface View {
  width: number;
  height: number;
}

/**
 * Share of the screen the diorama may take: about two thirds, still with air
 * around it (D60); on a portrait phone, width is the limit.
 */
const SHARE = { landscape: 0.78, portrait: 0.9, height: 0.78 } as const;
const PERSPECTIVE_FOV = 22;

/** Orbit limits: never under the ground nor straight down from above. */
const MIN_POLAR = deg(30);
const MAX_POLAR = deg(74);

/** Room around the plants when they are framed beside the detail sheet. */
const PLANTS_MARGIN = 1.25;

/** The view direction: the default (D60), or ?azimuth= to look from elsewhere. */
const DIRECTION = viewDirection(
  viewOptions.azimuth === null ? undefined : (viewOptions.azimuth * Math.PI) / 180,
);

function at(target: Vector3, distance: number): [number, number, number] {
  const position = target.clone().addScaledVector(DIRECTION, distance);
  return [position.x, position.y, position.z];
}

/**
 * The camera of the diorama (D40: orthographic; perspective kept to
 * compare, P07). It looks at the empty `cam_home` from Blender and frames
 * the whole model (plinth, steps and roof) by its real size, so changing the
 * model never needs new numbers here. Orbit with gentle inertia, no panning,
 * limited zoom.
 */
export function CameraRig({
  kind,
  zoom = 1,
  diorama,
}: {
  kind: CameraKind;
  zoom?: number;
  diorama: Pick<Diorama, 'bounds' | 'plants' | 'home' | 'focus' | 'nodes'>;
}) {
  const size = useThree((state) => state.size);
  const reducedMotion = useReducedMotion();
  const aspect = size.width / Math.max(1, size.height);
  // ?look= centres the view on a part (close-ups); otherwise cam_home.
  const home = useMemo(() => {
    const node = viewOptions.look === null ? undefined : diorama.nodes[viewOptions.look];
    return node ? new Box3().setFromObject(node).getCenter(new Vector3()) : diorama.home;
  }, [diorama.nodes, diorama.home]);
  const view = useMemo(() => projectedSize(diorama.bounds, DIRECTION), [diorama.bounds]);
  const plants = useMemo(() => {
    const { width, height } = projectedSize(diorama.plants, DIRECTION);
    return {
      view: { width: width * PLANTS_MARGIN, height: height * PLANTS_MARGIN },
      centre: diorama.plants.getCenter(new Vector3()),
    };
  }, [diorama.plants]);
  const fit = fitZoom(size, view);

  const controls = (
    <OrbitControls
      makeDefault
      target={home}
      enablePan={false}
      // Inertia is movement; with reduced motion the view stops where you leave it.
      enableDamping={!reducedMotion}
      dampingFactor={0.06}
      rotateSpeed={0.45}
      zoomSpeed={0.6}
      minPolarAngle={MIN_POLAR}
      maxPolarAngle={MAX_POLAR}
      {...(kind === 'orthographic'
        ? { minZoom: fit * 0.75, maxZoom: fit * 3.5 }
        : {
            minDistance: fitDistance(aspect, view) * 0.6,
            maxDistance: fitDistance(aspect, view) * 1.3,
          })}
    />
  );
  const focus = (
    <FocusOnSelection
      baseZoom={kind === 'orthographic' ? fit * zoom : 1}
      fitZoom={fit}
      reducedMotion={reducedMotion}
      home={home}
      plants={plants}
      focus={diorama.focus}
    />
  );
  const focusAndExit = (
    <>
      {focus}
      <ZoomOutCloses />
      {/* Development only: the landing video's camera (app/videoMode.ts), last so it wins. */}
      {import.meta.env.DEV && inVideoMode() && (
        <VideoCamera
          home={home}
          homeDirection={DIRECTION}
          fit={fit * zoom}
          focus={diorama.focus}
          nodes={diorama.nodes}
        />
      )}
    </>
  );

  return kind === 'orthographic' ? (
    <>
      <OrthographicCamera
        makeDefault
        position={at(home, 20)}
        zoom={fit * zoom}
        near={0.1}
        far={100}
      />
      {controls}
      {focusAndExit}
    </>
  ) : (
    <>
      <PerspectiveCamera
        makeDefault
        position={at(home, fitDistance(aspect, view) / zoom)}
        fov={PERSPECTIVE_FOV}
        near={0.05}
        far={100}
      />
      {controls}
      {focusAndExit}
    </>
  );
}

/**
 * Zooming out with the wheel (or a trackpad pinch) over the scene while a
 * plant is chosen leaves the focus: the sheet closes and the camera eases
 * back to the whole diorama. Small movements add up first, so a brush of a
 * trackpad does not close it; one wheel notch does.
 */
const ZOOM_OUT_CLOSE_PX = 40;
/** Wheel movements further apart than this start a new gesture. */
const WHEEL_GESTURE_MS = 250;
/** `deltaMode` 1 counts lines, 2 pages: roughly, in pixels. */
const WHEEL_UNIT_PX = [1, 16, 400] as const;

function ZoomOutCloses() {
  const element = useThree((state) => state.gl.domElement);
  const chosen = useSelection((state) => state.zoneId !== null);
  const close = useSelection((state) => state.close);

  useEffect(() => {
    if (!chosen) return;
    let outwards = 0;
    let last = 0;
    const onWheel = (event: WheelEvent) => {
      if (event.timeStamp - last > WHEEL_GESTURE_MS) outwards = 0;
      last = event.timeStamp;
      // Positive deltaY zooms out (OrbitControls); zooming in keeps the focus.
      const pixels = event.deltaY * (WHEEL_UNIT_PX[event.deltaMode] ?? 1);
      outwards = pixels > 0 ? outwards + pixels : 0;
      if (outwards >= ZOOM_OUT_CLOSE_PX) close();
    };
    element.addEventListener('wheel', onWheel, { passive: true });
    return () => {
      element.removeEventListener('wheel', onWheel);
    };
  }, [chosen, close, element]);

  return null;
}

/** Exponential easing constant: settles in roughly 600–900 ms (docs/03). */
const FOCUS_EASE_SECONDS = 0.16;
const DESKTOP_MIN_WIDTH = 768;
/** Desktop: the side sheet and its margins (24rem + 2 × 32 px). */
const SHEET_SIDE_PX = 448;
/** Room kept for the status line and the dock, above and below. */
const UI_VERTICAL_PX = 240;
/** How far the framing leans from the plants' centre towards the chosen plant. */
const LEAN_TO_PLANT = 0.3;
/** Mobile: closer on the plant, framed above the half-height sheet. */
const MOBILE_FOCUS_ZOOM = 2.8;
const SHEET_HALF_FRACTION = 0.5;

interface OrbitLike {
  target: Vector3;
  update(): void;
}

/** OrbitControls tell when the person starts to orbit or zoom. */
interface UserStart {
  addEventListener(type: 'start', listener: () => void): void;
  removeEventListener(type: 'start', listener: () => void): void;
}

/** Where the camera is easing to; `zoom: null` once the person zooms themselves. */
interface FocusGoal {
  target: Vector3;
  zoom: number | null;
  /** The home view also turns the camera back to the default direction (A2). */
  direction?: Vector3;
}

/** Zoomed in this far past the home view, the plants have room for their names (A2). */
const NAMES_FROM_ZOOM = 1.8;

/**
 * Zoomed in at all (D134): the dock folds, and the picture rises by half the
 * dock's height, so zooming brings the pots closer above the dock instead of
 * sliding them under it. On from `on` times the home zoom, off again below
 * `off` (so it never flickers at the threshold); the rise is whole by `full`.
 */
const CLOSER = { on: 1.3, off: 1.18, full: 1.6 } as const;
/** The dock is measured again every so many frames (it rarely changes). */
const DOCK_MEASURE_FRAMES = 20;

/** Away from home: further than this in zoom (relative), angle (rad) or target (world units). */
const AWAY = { zoom: 0.04, angle: 0.035, target: 0.02 } as const;

/**
 * docs/02: tapping a plant brings the camera closer with a soft curve and
 * frames it beside the detail sheet; closing the sheet goes back. With
 * reduced motion the view changes at once, without travelling.
 */
function FocusOnSelection({
  baseZoom,
  fitZoom: homeFit,
  reducedMotion,
  home,
  plants,
  focus,
}: {
  baseZoom: number;
  /** The zoom that frames the whole diorama, before any ?zoom= (for plant names). */
  fitZoom: number;
  reducedMotion: boolean;
  /** Where the camera rests (`cam_home`). */
  home: Vector3;
  /** All the plants: their on-screen size and their centre. */
  plants: { view: View; centre: Vector3 };
  /** Where to look at each plant (`cam_focus_<id>`). */
  focus: ReadonlyMap<string, Vector3>;
}) {
  const get = useThree((state) => state.get);
  const size = useThree((state) => state.size);
  const zoneId = useSelection((state) => state.zoneId);
  const homeRequests = useView((state) => state.homeRequests);
  const setAway = useView((state) => state.setAway);
  const setZoomedIn = useView((state) => state.setZoomedIn);
  const setCloser = useView((state) => state.setCloser);
  const closer = useRef(false);
  const lift = useRef({ frames: 0, dock: 0, shown: 0 });
  const controls = useThree((state) => state.controls) as unknown as UserStart | null;
  const goal = useRef<FocusGoal | null>(null);

  // The home view (button, double tap on empty space, H): leave any plant and
  // ease back to cam_home, the base zoom and the default direction.
  useEffect(() => {
    if (homeRequests === 0) return;
    useSelection.getState().close();
    goal.current = { target: home.clone(), zoom: baseZoom, direction: DIRECTION.clone() };
  }, [homeRequests, home, baseZoom]);

  // The person wins: as soon as they zoom or orbit during a move, the camera
  // stops imposing its zoom (it still recentres, which does not fight them).
  // Otherwise a wheel turned while the view eases back after leaving a
  // plant was undone every frame, and zooming felt stuck.
  useEffect(() => {
    if (!controls) return;
    const yieldZoom = () => {
      if (goal.current) goal.current.zoom = null;
    };
    controls.addEventListener('start', yieldZoom);
    return () => {
      controls.removeEventListener('start', yieldZoom);
    };
  }, [controls]);

  useEffect(() => {
    const point = zoneId === null ? undefined : focus.get(zoneId);
    if (!point) {
      goal.current = { target: home.clone(), zoom: baseZoom };
      return;
    }
    const { camera } = get();
    camera.updateMatrixWorld();
    const plant = point.clone();
    let zoom: number;
    let target: Vector3;
    if (size.width >= DESKTOP_MIN_WIDTH) {
      // Every pot in the free space beside the sheet, leaning to the chosen one.
      const freeWidth = size.width - SHEET_SIDE_PX;
      zoom = Math.min(
        (freeWidth * 0.85) / plants.view.width,
        (size.height - UI_VERTICAL_PX) / plants.view.height,
        baseZoom * 3.4,
      );
      zoom = Math.max(zoom, baseZoom);
      target = plants.centre.clone().lerp(plant, LEAN_TO_PLANT);
      const right = new Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
      target.addScaledVector(right, SHEET_SIDE_PX / 2 / zoom);
    } else {
      zoom = baseZoom * MOBILE_FOCUS_ZOOM;
      target = plant;
      const up = new Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
      target.addScaledVector(up, -(size.height * SHEET_HALF_FRACTION) / 2 / zoom);
    }
    goal.current = { target, zoom };
  }, [zoneId, baseZoom, get, size, home, plants, focus]);

  const shownZoom = useRef(0);
  useFrame((state, delta) => {
    // For the e2e tests: the orthographic zoom, written only when it changes.
    const zoomNow = state.camera instanceof ThreeOrthographicCamera ? state.camera.zoom : 0;
    if (Math.abs(zoomNow - shownZoom.current) > 0.5) {
      shownZoom.current = zoomNow;
      document.documentElement.dataset['cameraZoom'] = zoomNow.toFixed(1);
    }
    const controls = state.controls as OrbitLike | null;
    if (controls) {
      // Whether the home view would change anything (for its button).
      const ortho = state.camera instanceof ThreeOrthographicCamera ? state.camera : null;
      const direction = state.camera.position.clone().sub(controls.target).normalize();
      if (ortho) {
        const ratio = ortho.zoom / homeFit;
        setZoomedIn(ratio >= NAMES_FROM_ZOOM);
        closer.current = ratio >= (closer.current ? CLOSER.off : CLOSER.on);
        setCloser(closer.current);
        // The picture rises over the dock as the zoom grows; beside a sheet
        // the framing is already made for it.
        const l = lift.current;
        if (l.frames++ % DOCK_MEASURE_FRAMES === 0) {
          const bar = document.querySelector('.dock-bar')?.getBoundingClientRect();
          l.dock = bar ? Math.max(0, state.size.height - bar.top) : 0;
        }
        const amount = Math.min(1, Math.max(0, (ratio - 1) / (CLOSER.full - 1)));
        const goalLift = zoneId === null ? (l.dock / 2) * amount * amount * (3 - 2 * amount) : 0;
        const next =
          l.shown + (goalLift - l.shown) * (reducedMotion ? 1 : 1 - Math.exp(-delta / 0.2));
        if (Math.abs(next - l.shown) > 0.05 || (goalLift === 0 && l.shown !== 0)) {
          l.shown = Math.abs(goalLift - next) < 0.1 ? goalLift : next;
          const { width, height } = state.size;
          if (l.shown === 0) ortho.clearViewOffset();
          else ortho.setViewOffset(width, height, 0, l.shown, width, height);
        }
      }
      setAway(
        zoneId === null &&
          (direction.angleTo(DIRECTION) > AWAY.angle ||
            controls.target.distanceTo(home) > AWAY.target ||
            (ortho !== null && Math.abs(ortho.zoom / baseZoom - 1) > AWAY.zoom)),
      );
    }
    const current = goal.current;
    if (!current || !controls) return;
    const { camera } = state;
    const blend = reducedMotion ? 1 : 1 - Math.exp(-delta / FOCUS_EASE_SECONDS);
    if (current.direction) {
      const offset = camera.position.clone().sub(controls.target);
      const turned = offset.clone().normalize().lerp(current.direction, blend).normalize();
      camera.position.copy(controls.target).addScaledVector(turned, offset.length());
      if (turned.angleTo(current.direction) < 1e-4) delete current.direction;
    }
    const step = current.target.clone().sub(controls.target).multiplyScalar(blend);
    controls.target.add(step);
    camera.position.add(step);
    const ortho = camera instanceof ThreeOrthographicCamera ? camera : null;
    if (ortho && current.zoom !== null) {
      ortho.zoom += (current.zoom - ortho.zoom) * blend;
      ortho.updateProjectionMatrix();
    }
    controls.update();
    // Once there, hand the view back to the user.
    const zoomDone = !ortho || current.zoom === null || Math.abs(current.zoom - ortho.zoom) < 0.01;
    if (zoomDone && step.lengthSq() < 1e-10 && !current.direction) goal.current = null;
  });

  return null;
}

/** Pixels per world unit so the whole diorama takes its share of the screen. */
function fitZoom(size: { width: number; height: number }, view: View): number {
  const share = size.width < size.height ? SHARE.portrait : SHARE.landscape;
  return Math.min((size.width * share) / view.width, (size.height * SHARE.height) / view.height);
}

function fitDistance(aspect: number, view: View): number {
  const vertical = deg(PERSPECTIVE_FOV);
  const horizontal = 2 * Math.atan(Math.tan(vertical / 2) * aspect);
  const share = aspect < 1 ? SHARE.portrait : SHARE.landscape;
  return Math.max(
    view.height / SHARE.height / 2 / Math.tan(vertical / 2),
    view.width / share / 2 / Math.tan(horizontal / 2),
  );
}
