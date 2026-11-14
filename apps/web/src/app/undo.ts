import { create } from 'zustand';

/**
 * "Deshacer" for 5 s (docs/03), kept for destructive actions that one tap
 * cannot revert (e.g. deleting a journal note, A8). Toggles have none: the
 * control is the way back (D85); watering is stopped with "Detener" (D84).
 */
export const UNDO_MS = 5_000;

export interface UndoOffer {
  id: number;
  message: string;
  /** What it is about, e.g. `water:basil_01`, to show it elsewhere too. */
  key: string | undefined;
}

interface UndoState {
  offers: UndoOffer[];
}

export const useUndo = create<UndoState>()(() => ({ offers: [] }));

interface Entry {
  revert: () => void;
  timer: ReturnType<typeof setTimeout>;
}

const entries = new Map<number, Entry>();
let nextId = 1;

function remove(id: number) {
  const entry = entries.get(id);
  if (entry) clearTimeout(entry.timer);
  entries.delete(id);
  useUndo.setState((state) => ({ offers: state.offers.filter((offer) => offer.id !== id) }));
}

function add(offer: Omit<UndoOffer, 'id'>, revert: () => void, ms: number) {
  const id = nextId++;
  // A new offer about the same thing replaces the old one.
  for (const old of useUndo.getState().offers) {
    if (offer.key && old.key === offer.key) remove(old.id);
  }
  const timer = setTimeout(() => {
    remove(id);
  }, ms);
  entries.set(id, { revert, timer });
  useUndo.setState((state) => ({ offers: [...state.offers, { id, ...offer }] }));
  return id;
}

/** The change has been made; for 5 s, Undo reverts it. */
export function offerUndo(message: string, revert: () => void, key?: string): number {
  return add({ message, key }, revert, UNDO_MS);
}

export function undo(id: number): void {
  const entry = entries.get(id);
  if (!entry) return;
  remove(id);
  entry.revert();
}

/** Ctrl/Cmd+Z: the most recent offer. */
export function undoLatest(): boolean {
  const latest = useUndo.getState().offers.at(-1);
  if (!latest) return false;
  undo(latest.id);
  return true;
}

export function dismiss(id: number): void {
  remove(id);
}

/** For tests: forget every offer. */
export function resetUndo(): void {
  for (const id of entries.keys()) remove(id);
}
