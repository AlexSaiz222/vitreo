import type { DemoScenario } from '../demo/protocol.ts';

/**
 * "Probar situaciones" (D103, D111): the demo's greenhouse, in its worker,
 * makes one happen. Set by the demo's link (data/demoLink.ts); until then,
 * and at home, there is nowhere to send it.
 */
let send: ((name: DemoScenario) => void) | null = null;

export function setDemoScenarios(sender: ((name: DemoScenario) => void) | null): void {
  send = sender;
}

/** Whether it could be asked for. */
export function tryScenario(name: DemoScenario): boolean {
  if (!send) return false;
  send(name);
  return true;
}
