import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { simMemory } from '@vitreo/sim-core';
import type { SimMemory } from '@vitreo/sim-core';

/**
 * The daily simulator's memory on disk (D100): a release or a reboot of the
 * PC restarts it, and the greenhouse carries on where it was instead of
 * starting wet again. Only the daily simulator has a file
 * (`SIMULATOR_STATE_FILE`); the e2e ones always start fresh.
 */
export function readMemory(file: string): SimMemory | null {
  let raw: string;
  try {
    raw = readFileSync(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  try {
    const parsed = simMemory.safeParse(JSON.parse(raw));
    if (parsed.success) return parsed.data;
  } catch {
    // Unreadable: said below, and the greenhouse starts fresh.
  }
  console.warn(`[simulator] ${file} is not a memory this version can read: starting fresh`);
  return null;
}

/** Written whole and then renamed, so a stop halfway never leaves half a file. */
export function writeMemory(file: string, memory: SimMemory): void {
  mkdirSync(dirname(file), { recursive: true });
  const partial = `${file}.tmp`;
  writeFileSync(partial, JSON.stringify(memory));
  renameSync(partial, file);
}
