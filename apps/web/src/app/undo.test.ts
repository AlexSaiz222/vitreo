import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { offerUndo, resetUndo, undo, undoLatest, UNDO_MS, useUndo } from './undo.ts';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  resetUndo();
  vi.useRealTimers();
});

describe('undo', () => {
  it('reverts a change while it is offered, then forgets it', () => {
    const revert = vi.fn();
    const id = offerUndo('Luz encendida', revert);
    expect(useUndo.getState().offers).toHaveLength(1);
    undo(id);
    expect(revert).toHaveBeenCalledOnce();
    expect(useUndo.getState().offers).toHaveLength(0);
  });

  it('the offer ends after 5 s', () => {
    const revert = vi.fn();
    offerUndo('Luz encendida', revert);
    vi.advanceTimersByTime(UNDO_MS + 1);
    expect(useUndo.getState().offers).toHaveLength(0);
    expect(undoLatest()).toBe(false);
    expect(revert).not.toHaveBeenCalled();
  });

  it('keeps one offer per subject: the newest', () => {
    const first = vi.fn();
    const second = vi.fn();
    offerUndo('Luz encendida', first, 'light');
    offerUndo('Luz apagada', second, 'light');
    expect(useUndo.getState().offers.map((o) => o.message)).toEqual(['Luz apagada']);
    undoLatest();
    expect(second).toHaveBeenCalledOnce();
    expect(first).not.toHaveBeenCalled();
  });
});
