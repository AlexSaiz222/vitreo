import { StrictMode } from 'react';
import type { ComponentType } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App.tsx';
import { startDayNightClock } from './app/dayNight.ts';
import { openFromUrl } from './app/deepLink.ts';
import { currentLocation } from './app/location.ts';
import { hasWebGL, useSettings } from './app/settings.ts';
import { greenhouseStore, startDataLayer } from './data/greenhouse.ts';
import { startAutomationWatch } from './data/automation.ts';
import { startWeatherWatch } from './data/weather.ts';
import { configureHub, startHubCheck } from './data/hub.ts';
import { startJournalSync } from './data/journal.ts';
import { mixInput, startAmbientSound } from './features/sound/ambient.ts';
import { sceneReading } from './data/sceneReading.ts';
import { startTouchSounds } from './features/sound/touch.ts';
import './styles/fonts.css';
import './styles/tokens.css';
import './styles/base.css';

// Day and night follow the real sun where the greenhouse is (Ajustes ›
// Ubicación), unless Ajustes › Apariencia or ?theme= forces one.
startDayNightClock(currentLocation);

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');
const container = root;

startDataLayer();
// The hub is optional for the live greenhouse; it is checked every 30 s (A4).
configureHub({
  apiUrl: import.meta.env.VITE_API_URL,
  deviceId: greenhouseStore.getState().deviceId,
});
startHubCheck();
// Journal entries written while the hub was down go when it answers (A8).
startJournalSync();
// The greenhouse's word on each config revision, as soon as it arrives (A6).
startAutomationWatch();
// The hub's word on the outdoor weather and its rules (A10).
startWeatherWatch();
// Opened from a notification: straight to what it is about (A7).
openFromUrl();
// Ambient sound (A9): only if turned on; nothing is downloaded otherwise.
startAmbientSound();
// The interface's soft touches (D128), under the same switch.
startTouchSounds();

// No WebGL at all: the plant list from the start, never a blank page (A3).
if (!hasWebGL()) useSettings.getState().markWebglFailed();

async function render() {
  let Root: ComponentType = App;
  // The primitives catalogue (?ui=lab) is imported only in development, so it
  // never reaches the production build.
  if (import.meta.env.DEV) {
    const { readDevPreview } = await import('./app/devPreview.ts');
    if (readDevPreview(location.search).lab) Root = (await import('./ui/lab/Lab.tsx')).Lab;
    // The landing video (D130): what the greenhouse sounds like at each frame.
    const { inVideoMode, videoApi } = await import('./app/videoMode.ts');
    if (inVideoMode()) {
      videoApi().sample = () => ({
        mix: mixInput(),
        actuators: greenhouseStore.getState().telemetry?.actuators ?? null,
        live: sceneReading.live(),
      });
    }
  }
  createRoot(container).render(
    <StrictMode>
      <Root />
    </StrictMode>,
  );
}

void render();
