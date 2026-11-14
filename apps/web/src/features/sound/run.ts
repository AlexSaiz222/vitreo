import { create } from 'zustand';

import { useSettings } from '../../app/settings.ts';
import { AmbientEngine } from './engine.ts';
import { mixFor } from './mix.ts';
import type { MixInput } from './mix.ts';

/**
 * The ambient sound's life (A9, D96), shared by the app and the notebook's
 * page (D129): it starts on the tap that turns it on (or on the first tap
 * after a page opens with sound on, if the browser asks for one), follows
 * what it is told once a second, pauses while the page is hidden, and frees
 * everything when it is turned off. Nothing is downloaded while it is off.
 */
export type SoundStatus = 'off' | 'loading' | 'waiting-tap' | 'playing' | 'failed';

export const useSound = create<{ status: SoundStatus }>()(() => ({ status: 'off' }));

const FOLLOW_EVERY_MS = 1000;
/**
 * The first seconds after it starts, the layers come in this fast (s): a
 * new page (the notebook, the way back from it) keeps the sound almost at
 * once, instead of the slow fades the mix uses as the day changes.
 */
const START_FADE_SECONDS = 0.6;
const START_FOR_MS = 3000;

export interface AmbientRun {
  /** The engine while the sound is on, for what plays over the bed. */
  engine: () => AmbientEngine | null;
  stop: () => void;
}

export function runAmbient(input: () => MixInput): AmbientRun {
  let engine: AmbientEngine | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let startedAt = 0;
  const set = (status: SoundStatus) => {
    useSound.setState({ status });
  };

  const follow = () => {
    if (!engine) return;
    const starting = performance.now() - startedAt < START_FOR_MS;
    engine.apply(
      mixFor(input()),
      useSettings.getState().volume,
      starting ? START_FADE_SECONDS : undefined,
    );
  };

  // Browsers start audio only from a gesture: the first tap or key after
  // the page opens with sound on.
  const onGesture = () => {
    void engine?.resume().then(() => {
      if (engine?.running) {
        set('playing');
        removeGesture();
      }
    });
  };
  const removeGesture = () => {
    removeEventListener('pointerdown', onGesture);
    removeEventListener('keydown', onGesture);
  };

  const turnOn = () => {
    if (engine) return;
    const created = new AmbientEngine();
    engine = created;
    set('loading');
    // Called inside the tap that turned it on: resuming is allowed there.
    void created.resume();
    created
      .load()
      .then(() => {
        if (engine !== created) return;
        startedAt = performance.now();
        follow();
        if (created.running) set('playing');
        else {
          set('waiting-tap');
          addEventListener('pointerdown', onGesture);
          addEventListener('keydown', onGesture);
        }
      })
      .catch(() => {
        if (engine === created) set('failed');
      });
    timer = setInterval(follow, FOLLOW_EVERY_MS);
  };

  const turnOff = () => {
    removeGesture();
    if (timer) clearInterval(timer);
    timer = null;
    const closing = engine;
    engine = null;
    set('off');
    void closing?.close();
  };

  const onVisibility = () => {
    if (!engine) return;
    if (document.hidden) void engine.pause();
    else
      void engine.resume().then(() => {
        follow();
      });
  };

  if (useSettings.getState().sound) turnOn();
  const unsubscribe = useSettings.subscribe((state, previous) => {
    if (state.sound !== previous.sound) {
      if (state.sound) turnOn();
      else turnOff();
    } else if (state.volume !== previous.volume) follow();
  });
  document.addEventListener('visibilitychange', onVisibility);
  return {
    engine: () => engine,
    stop: () => {
      unsubscribe();
      document.removeEventListener('visibilitychange', onVisibility);
      turnOff();
    },
  };
}
