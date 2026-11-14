import { create } from 'zustand';

import type { DemoSpeed } from '../demo/protocol.ts';

/**
 * The demo's speed (D112), as its worker last told it: null until then
 * (and always at home). Set by the demo's link (data/demoLink.ts).
 */
export const useDemoSpeed = create<{ speed: DemoSpeed | null }>(() => ({ speed: null }));

let send: ((speed: DemoSpeed) => void) | null = null;

export function setDemoSpeedSender(sender: ((speed: DemoSpeed) => void) | null): void {
  send = sender;
}

/** Asks the demo's worker for this speed; the answer comes as its clock. */
export function chooseSpeed(speed: DemoSpeed): void {
  send?.(speed);
}
