import { lazy, Suspense, useEffect, useRef } from 'react';

import { useHud } from './app/hud.ts';
import { useSelection } from './app/selection.ts';
import { useEffectiveQuality } from './app/settings.ts';
import { useShortcuts } from './app/shortcuts.ts';
import { greenhouseStore, useFreshness } from './data/greenhouse.ts';
import { useReplay } from './data/replay.ts';
import { useReplayGap, useReplaying } from './data/shown.ts';
import { RewindButton, Timeline } from './features/history/Timeline.tsx';
import { ZONES } from './scene/zones.ts';

import './App.css';
import { switchLight } from './ui/actions.ts';
import { AlertStack } from './ui/AlertStack.tsx';
import { Dock } from './ui/Dock.tsx';
import { GreenhouseButton } from './ui/GreenhouseButton.tsx';
import { HomeButton } from './ui/HomeButton.tsx';
import { PlantAnchors } from './ui/PlantAnchors.tsx';
import { PlantList2D } from './ui/PlantList2D.tsx';
import { PlantSheet } from './ui/PlantSheet.tsx';
import { SceneBoundary } from './ui/SceneBoundary.tsx';
import { SceneSummary } from './ui/SceneSummary.tsx';
import { SettingsButton, SettingsSheet } from './ui/SettingsSheet.tsx';
import { GreenhouseSheet } from './features/greenhouse/GreenhouseSheet.tsx';
import { ShortcutsHelp } from './ui/ShortcutsHelp.tsx';
import { StatusLine } from './ui/StatusLine.tsx';
import './ui/ui.css';
import { Welcome } from './ui/Welcome.tsx';

// The interface renders first; the 3D scene arrives when its chunk has loaded
// (and never, without 3D: A3).
const Scene = lazy(() => import('./scene/Scene.tsx'));
// The demo's own line (D103, D111): only in the demo build, which the home build leaves out.
// Inline (not IN_DEMO): Vite replaces it, so the home build has no DemoBar chunk at all.
const DemoBar = import.meta.env.MODE === 'demo' ? lazy(() => import('./demo/DemoBar.tsx')) : null;
// The demo's notebook, one more round icon at the top right (D113, D115).
const NotebookButton =
  import.meta.env.MODE === 'demo' ? lazy(() => import('./demo/NotebookButton.tsx')) : null;

/** L: the grow light, from the latest telemetry (never while showing the past). */
const toggleLight = () => {
  if (useReplay.getState().mode === 'replay') return;
  switchLight(!(greenhouseStore.getState().telemetry?.actuators.growLight ?? false));
};

export function App() {
  const freshness = useFreshness();
  const quality = useEffectiveQuality();
  const flat = quality === 'flat';
  const replaying = useReplaying();
  const replayGap = useReplayGap();
  // Rewound, the scene is the past: asleep only where there were no readings.
  const sceneFreshness = replaying ? (replayGap ? 'disconnected' : 'live') : freshness.kind;
  useShortcuts({ zones: ZONES, toggleLight });

  // How tall the top is now, for what has to start below it (the list without 3D).
  const hudTop = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const top = hudTop.current;
    if (!top) return;
    const observer = new ResizeObserver(() => {
      document.documentElement.style.setProperty('--hud-top-height', `${top.offsetHeight.toString()}px`);
    });
    observer.observe(top);
    return () => {
      observer.disconnect();
    };
  }, []);

  // One panel at a time: opening a plant closes Ajustes, and the other way round.
  const zoneId = useSelection((state) => state.zoneId);
  const panel = useHud((state) => state.panel);
  useEffect(() => {
    if (zoneId !== null) useHud.getState().setPanel(null);
  }, [zoneId]);
  useEffect(() => {
    if (panel !== null) useSelection.getState().close();
  }, [panel]);

  return (
    <main className="app-shell" data-quality={quality} data-replay={replaying}>
      <h1 className="visually-hidden">Vitreo</h1>
      {flat ? (
        <PlantList2D />
      ) : (
        <>
          <div className="app-scene" data-freshness={sceneFreshness} aria-hidden="true">
            <SceneBoundary>
              <Suspense fallback={null}>
                <Scene />
              </Suspense>
            </SceneBoundary>
          </div>
          <PlantAnchors />
        </>
      )}
      <div className="hud-scrim" aria-hidden="true" />
      <div className="hud-top" data-hud-obstacle="" ref={hudTop}>
        <div className="hud-top-row">
          <StatusLine />
          <div className="hud-controls">
            <SettingsButton />
            <GreenhouseButton />
            {!replaying && <RewindButton />}
            {!flat && <HomeButton />}
            {NotebookButton && (
              <Suspense fallback={null}>
                <NotebookButton />
              </Suspense>
            )}
          </div>
        </div>
        {DemoBar && (
          <Suspense fallback={null}>
            <DemoBar live={!replaying} />
          </Suspense>
        )}
        {/* Notices are about now: they wait while the past is shown. */}
        {!replaying && <AlertStack />}
      </div>
      <SceneSummary />
      {/* The past cannot be ordered: the rewind bar takes the dock's place. */}
      {replaying ? <Timeline /> : <Dock />}
      <PlantSheet />
      <SettingsSheet />
      <GreenhouseSheet />
      <ShortcutsHelp />
      <Welcome />
    </main>
  );
}
