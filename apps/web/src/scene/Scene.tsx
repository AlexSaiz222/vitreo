import { Canvas, useFrame } from '@react-three/fiber';
import { PerformanceMonitor, Stats } from '@react-three/drei';
import { Suspense, useEffect, useRef } from 'react';
import { Color } from 'three';

import { useSelection } from '../app/selection.ts';
import { markerAt } from '../app/anchors.ts';
import { useEffectiveQuality, useSettings } from '../app/settings.ts';
import { useView } from '../app/view.ts';
import { viewOptions } from '../app/viewOptions.ts';
import { useFreshness } from '../data/greenhouse.ts';
import { useReplayGap, useShownGrowLight } from '../data/shown.ts';
import { useThresholds } from '../data/thresholds.ts';
import { Atmosphere } from './Ambience.tsx';
import { sceneWeather } from './atmosphere.ts';
import { CameraRig } from './CameraRig.tsx';
import { useLightmaps } from './lightmaps.ts';
import { Lights } from './Lights.tsx';
import type { NightBlend } from './Lights.tsx';
import { useDiorama } from './models/diorama.ts';
import { GreenhouseModel } from './models/GreenhouseModel.tsx';
import { PlantModel } from './models/PlantModel.tsx';
import { PlantTracker } from './PlantTracker.tsx';
import { useScenePalette } from './palette.ts';
import type { ScenePalette } from './palette.ts';
import { useTheme } from './useTheme.ts';
import type { ThemeMode } from './useTheme.ts';
import { withThresholds, ZONES } from './zones.ts';

/**
 * Marks the page once the scene has drawn a few frames, with the draw calls
 * and triangles of one whole frame: scene, shadow maps and post-processing
 * passes (used by Playwright: captures and the performance budget).
 *
 * The renderer resets its counters on every render call, and the effect
 * composer renders several times per frame, so counting is done by hand:
 * reset once per frame, read the total a frame later. Read again every half
 * second after that: effects that fade in (rain, A10) are counted too.
 */
function ReadySignal() {
  const frames = useRef(0);
  useFrame((state) => {
    const info = state.gl.info;
    info.autoReset = false;
    frames.current++;
    if (frames.current >= 30 && frames.current % 30 === 0) {
      const root = document.documentElement;
      root.dataset['drawCalls'] = info.render.calls.toString();
      root.dataset['triangles'] = info.render.triangles.toString();
      root.dataset['sceneReady'] = 'true';
    }
    info.reset();
  });
  return null;
}

/**
 * The diorama from Blender (vitreo.glb, docs/04) at real size, with the
 * camera and the lights fitted to it. Suspends until the model is loaded,
 * so the scene is only marked ready once it is really there.
 */
function Diorama({
  palette,
  theme,
  sleeping,
}: {
  palette: ScenePalette;
  theme: ThemeMode;
  sleeping: boolean;
}) {
  const diorama = useDiorama();
  const growLight = useShownGrowLight();
  const lightmaps = useLightmaps(theme, growLight, {
    moon: palette.moon,
    glow: palette.nightGlow,
    shadow: palette.shadow,
  });
  // Each plant wilts below its own threshold (D100).
  const thresholds = useThresholds();
  return (
    <>
      <CameraRig kind={viewOptions.camera} zoom={viewOptions.zoom} diorama={diorama} />
      <Lights
        palette={palette}
        sleeping={sleeping}
        bounds={diorama.bounds}
        ground={diorama.ground}
        body={diorama.body}
        night={lightmaps.uniforms}
      />
      <Background palette={palette} night={lightmaps.uniforms} />
      <Atmosphere
        nodes={diorama.nodes}
        palette={palette}
        body={diorama.body}
        night={lightmaps.uniforms}
        sleeping={sleeping}
      />
      <GreenhouseModel
        nodes={diorama.nodes}
        palette={palette}
        body={diorama.body}
        lightmaps={lightmaps}
      />
      {withThresholds(ZONES, thresholds).map((zone) => (
        <PlantModel
          key={zone.id}
          zone={zone}
          nodes={diorama.nodes}
          palette={palette}
          lightmaps={lightmaps}
          night={theme === 'night'}
        />
      ))}
      <PlantTracker />
      <ReadySignal />
    </>
  );
}

/** 0 … 1, slow at both ends. */
const smooth = (t: number) => t * t * (3 - 2 * t);

/**
 * The page colour behind the diorama, blended day and night through
 * twilight with the scene's light (A9); the interface switches at the horizon.
 * It passes through the warm of a sunset (D135): cream and ink blue blended
 * straight gave a flat grey half way. The colour of each frame is also
 * published as `--page-now`, for the veil behind the header.
 */
function Background({ palette, night }: { palette: ScenePalette; night: NightBlend }) {
  const published = useRef('');
  useFrame((state) => {
    const background = state.scene.background;
    if (background instanceof Color) {
      // Under clouds the day page is a touch greyer (A10), and the sunset fainter.
      DAY_PAGE.lerpColors(palette.dayBg, palette.overcast, sceneWeather.clouds);
      DUSK_PAGE.lerpColors(palette.duskBg, palette.overcast, sceneWeather.clouds * 0.6);
      const n = night.current.uNightMix.value;
      if (n < 0.5) background.lerpColors(DAY_PAGE, DUSK_PAGE, smooth(n * 2));
      else background.lerpColors(DUSK_PAGE, palette.nightBg, smooth(n * 2 - 1));
      const hex = `#${background.getHexString()}`;
      if (hex !== published.current) {
        published.current = hex;
        const root = document.documentElement;
        root.style.setProperty('--page-now', hex);
        // Which ink reads on it: dark ink until the page is dark, with a
        // margin so it never flickers at the threshold.
        const luminance = 0.2126 * background.r + 0.7152 * background.g + 0.0722 * background.b;
        const dark = root.dataset['pageTone'] === 'dark';
        const tone = luminance < (dark ? PAGE_TONE.light : PAGE_TONE.dark) ? 'dark' : 'light';
        if (root.dataset['pageTone'] !== tone) root.dataset['pageTone'] = tone;
      }
    }
  });
  // Without the scene (Sin 3D) the page is the theme's own again.
  useEffect(
    () => () => {
      document.documentElement.style.removeProperty('--page-now');
      delete document.documentElement.dataset['pageTone'];
    },
    [],
  );
  return null;
}

/**
 * The page's (linear) luminance below which light ink reads better than dark
 * (where both contrast the same, ≈ 0.18), and where it goes back.
 */
const PAGE_TONE = { dark: 0.16, light: 0.22 } as const;

/** Reused every frame: the day page and the sunset page, greyer under clouds. */
const DAY_PAGE = new Color();
const DUSK_PAGE = new Color();

/** Two taps on empty space closer than this are a double tap. */
const DOUBLE_TAP_MS = 350;

/** The scene only reads from the store; it never talks to MQTT. */
export default function Scene() {
  const theme = useTheme();
  const palette = useScenePalette(theme);
  const replayGap = useReplayGap();
  // Disconnected, or rewound to an instant with no readings (A5).
  const sleeping = useFreshness().kind === 'disconnected' || replayGap;
  const closeSheet = useSelection((state) => state.close);
  const openPlant = useSelection((state) => state.open);
  const goHome = useView((state) => state.goHome);
  const lastMiss = useRef(0);
  // Quality (A3, D86): low draws at 1 px per CSS pixel (on a phone, several
  // times fewer pixels); Auto lowers itself if frames get slow.
  const quality = useEffectiveQuality();
  const auto = useSettings((state) => state.quality === 'auto');
  const lowerAuto = useSettings((state) => state.lowerAuto);

  return (
    <Canvas
      flat
      dpr={quality === 'low' ? 1 : [1, 2]}
      gl={{ antialias: true }}
      // Tapping empty space closes the detail sheet (docs/03); a double tap
      // there goes back to the home view (A2). R3F calls this only for taps
      // (a press that did not move), never after orbiting.
      onPointerMissed={(event: MouseEvent) => {
        // A tap on a plant's warning or label (they let the pointer through).
        const zone = markerAt(event.clientX, event.clientY);
        if (zone) {
          openPlant(zone);
          return;
        }
        closeSheet();
        if (event.timeStamp - lastMiss.current < DOUBLE_TAP_MS) goHome();
        lastMiss.current = event.timeStamp;
      }}
    >
      {/* The page colour (tokens.css --bg), drawn by the scene itself. */}
      <color attach="background" args={[palette.bg]} />
      {/* The model and its lightmaps are precached by the service worker. */}
      <Suspense fallback={null}>
        <Diorama palette={palette} theme={theme} sleeping={sleeping} />
      </Suspense>
      {auto && quality === 'high' && <PerformanceMonitor onDecline={lowerAuto} />}
      {viewOptions.stats && <Stats />}
      {/* No screen-space ambient occlusion: it is baked (docs/04, part 5). */}
    </Canvas>
  );
}
