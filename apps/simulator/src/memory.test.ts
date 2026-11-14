import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_PARAMS, GreenhouseSim } from '@vitreo/sim-core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { readMemory, writeMemory } from './memory.ts';

const dirs: string[] = [];
const tempFile = () => {
  const dir = mkdtempSync(join(tmpdir(), 'vitreo-sim-'));
  dirs.push(dir);
  return join(dir, 'nested', 'state.json');
};
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('the daily simulator memory on disk (D100)', () => {
  it('is written whole and read back', () => {
    const file = tempFile();
    const memory = new GreenhouseSim(DEFAULT_PARAMS, 0).memory(1000);
    writeMemory(file, memory);
    expect(readMemory(file)).toEqual(memory);
  });

  it('none yet, or unreadable: a fresh greenhouse', () => {
    const file = tempFile();
    expect(readMemory(file)).toBeNull();
    writeMemory(file, new GreenhouseSim(DEFAULT_PARAMS, 0).memory(0));
    writeFileSync(file, '{"v": 99}');
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(readMemory(file)).toBeNull();
  });
});
