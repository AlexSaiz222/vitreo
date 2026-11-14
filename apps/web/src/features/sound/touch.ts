import { useHud } from '../../app/hud.ts';
import { useSelection } from '../../app/selection.ts';
import { useSettings } from '../../app/settings.ts';
import { greenhouseStore } from '../../data/greenhouse.ts';
import { useReplay } from '../../data/replay.ts';
import { sceneReading } from '../../data/sceneReading.ts';
import { createCueGate, cuesBetween } from './deviceCues.ts';
import type { DeviceState } from './deviceCues.ts';
import { DeviceSounds } from './deviceSound.ts';
import { createTouchGate, pressCue, shapeOf, TouchSounds } from './touchSound.ts';
import type { TouchCue } from './touchSound.ts';

/** What answers a touch: buttons, links, switches, segments, the plants' labels. */
const PRESSABLE =
  'button, a[href], [role="switch"], [role="radio"], [role="tab"], [role="menuitem"], summary, label:has(input)';
/** Panels whose scrolling is heard. */
const SCROLLERS = '.ui-sheet, .dock-menu';
/** A press this soon after a panel's sound is part of it (ms). */
const PANEL_SWALLOWS_MS = 120;

/** The devices as the data has them now (D121); null before any telemetry. */
function deviceState(): DeviceState | null {
  const actuators = greenhouseStore.getState().telemetry?.actuators;
  if (!actuators) return null;
  return {
    live: sceneReading.live() && useReplay.getState().mode !== 'replay',
    pump: actuators.pump,
    growLight: actuators.growLight,
    fan: actuators.fan,
    vent: actuators.vent,
  };
}

/** The touches and the devices, on one small low-latency audio context. */
class EffectSounds {
  readonly touch: TouchSounds;
  readonly devices: DeviceSounds;
  private readonly deviceLevel: GainNode;

  constructor(private readonly context: AudioContext) {
    this.touch = new TouchSounds(context);
    this.deviceLevel = context.createGain();
    this.deviceLevel.connect(context.destination);
    this.devices = new DeviceSounds(context, this.deviceLevel, Math.random);
    this.setVolume(useSettings.getState().volume);
  }

  get running(): boolean {
    return this.context.state === 'running';
  }

  /** A gentle curve, as the ambient's: the slider's middle sounds like the middle. */
  setVolume(volume: number): void {
    this.deviceLevel.gain.setTargetAtTime(volume * volume, this.context.currentTime, 0.05);
  }

  async resume(): Promise<void> {
    if (this.context.state !== 'running') await this.context.resume();
  }

  async close(): Promise<void> {
    this.devices.silence();
    await this.context.close();
  }
}

/**
 * The interface's sounds (D128) and the devices' (D121), each with its own
 * switch in Ajustes › Sonido since D131, whether the ambient sound is on or
 * not. The audio context starts on the first tap after one is on, as
 * browsers require, and closes when both are off. Listens at the document,
 * so every control has them without each one asking; a device is heard
 * when the data says it changed, and only then.
 */
export function startTouchSounds(): () => void {
  let sounds: EffectSounds | null = null;
  const gate = createTouchGate();
  const touchOn = () => useSettings.getState().touchSounds && !document.hidden;
  const devicesOn = () => useSettings.getState().deviceSounds;
  const wanted = () => {
    const { touchSounds, deviceSounds } = useSettings.getState();
    return touchSounds || deviceSounds;
  };

  // A press that opens or closes a panel is heard as the panel only.
  let panelAt = -Infinity;
  const play = (cue: TouchCue) => {
    if (!sounds?.running || !touchOn()) return;
    const now = performance.now();
    if (cue === 'open' || cue === 'close') panelAt = now;
    else if (cue !== 'scroll' && cue !== 'hover' && now - panelAt < PANEL_SWALLOWS_MS) return;
    if (!gate(cue, now)) return;
    sounds.touch.play(shapeOf(cue, Math.random() * 2 - 1), useSettings.getState().volume);
  };

  // Created inside a gesture, so it may start.
  const wake = () => {
    if (!wanted()) return;
    sounds ??= new EffectSounds(new AudioContext({ latencyHint: 'interactive' }));
    void sounds.resume();
  };
  const sleep = () => {
    const closing = sounds;
    sounds = null;
    void closing?.close();
  };

  let devices = deviceState();
  const deviceGate = createCueGate();
  const stopDevices = greenhouseStore.subscribe((state, previous) => {
    if (state.telemetry === previous.telemetry) return;
    const now = deviceState();
    if (!now) return;
    const cues = cuesBetween(devices, now);
    devices = now;
    if (!sounds?.running || !devicesOn()) return;
    for (const cue of cues) if (deviceGate(cue, Date.now())) sounds.devices.play(cue);
  });

  let hovered: Element | null = null;
  const onPointerOver = (event: PointerEvent) => {
    if (event.pointerType !== 'mouse') return;
    const target = (event.target as Element | null)?.closest(PRESSABLE) ?? null;
    if (target === hovered) return;
    hovered = target;
    if (target && !target.matches(':disabled, [aria-disabled="true"]')) play('hover');
  };

  // Heard on the way down (capture), before React acts on the click: a
  // device's button then waits for its answer (`aria-disabled`), and seen
  // after, the press it just took would be taken for a refusal.
  const onClick = (event: MouseEvent) => {
    const target = (event.target as Element | null)?.closest(PRESSABLE);
    if (!target || target.matches(':disabled, [aria-disabled="true"]')) return;
    // A label's click reaches its input too: one sound, from the input.
    if (target.matches('label')) return;
    // After the control has changed (React renders in this same task).
    setTimeout(() => {
      play(pressCue(target));
    }, 0);
  };

  const onInput = (event: Event) => {
    if ((event.target as Element | null)?.matches('input[type="range"]')) play('step');
  };

  const onScroll = (event: Event) => {
    const target = event.target;
    if (target instanceof Element && target.matches(SCROLLERS)) play('scroll');
  };

  // A panel opening or closing: a sheet, Ajustes, the greenhouse.
  const stopPanels = useHud.subscribe((state, previous) => {
    if (state.panel === previous.panel || state.panel === 'welcome') return;
    if (state.panel && !previous.panel) play('open');
    else if (!state.panel && previous.panel) play('close');
  });
  const stopPlants = useSelection.subscribe((state, previous) => {
    if (state.zoneId === previous.zoneId) return;
    if (state.zoneId && !previous.zoneId) play('open');
    else if (!state.zoneId && previous.zoneId) play('close');
  });

  const stopSettings = useSettings.subscribe((state, previous) => {
    const was = previous.touchSounds || previous.deviceSounds;
    const is = state.touchSounds || state.deviceSounds;
    // Turned on by a tap: still inside it, so the context may start now
    // and the switch itself is heard.
    if (is && !was) wake();
    if (was && !is) sleep();
    if (previous.deviceSounds && !state.deviceSounds) sounds?.devices.silence();
    if (state.volume !== previous.volume) sounds?.setVolume(state.volume);
  });

  addEventListener('pointerdown', wake, true);
  addEventListener('keydown', wake, true);
  document.addEventListener('pointerover', onPointerOver);
  document.addEventListener('click', onClick, true);
  document.addEventListener('input', onInput);
  document.addEventListener('scroll', onScroll, { capture: true, passive: true });
  return () => {
    stopPanels();
    stopPlants();
    stopSettings();
    stopDevices();
    removeEventListener('pointerdown', wake, true);
    removeEventListener('keydown', wake, true);
    document.removeEventListener('pointerover', onPointerOver);
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('input', onInput);
    document.removeEventListener('scroll', onScroll, { capture: true });
    sleep();
  };
}
