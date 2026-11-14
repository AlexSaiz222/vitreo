import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { configureHub } from './hub.ts';
import { addNote, discardPending, flushJournal, loadJournal, useJournal } from './journal.ts';

/**
 * The journal on the phone (A8, D93): a new entry is never lost silently.
 * With the hub down it waits and says so; it goes when the hub answers.
 */
const T0 = Date.parse('2026-10-12T10:00:00Z');

type Reply = { status: number; body?: unknown } | 'offline';
let reply: (method: string, path: string, body: unknown) => Reply;
const calls: string[] = [];

beforeEach(() => {
  configureHub({ deviceId: 'sim' });
  useJournal.setState({ byZone: {}, pending: [], hidden: [] });
  calls.length = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const path = url.replace(/^\/api\/v1/, '').replace(/\?.*$/, '');
      calls.push(`${method} ${path}`);
      const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : null;
      const answer = reply(method, path, body);
      if (answer === 'offline') return Promise.reject(new TypeError('Failed to fetch'));
      return Promise.resolve(
        new Response(answer.body === undefined ? '' : JSON.stringify(answer.body), {
          status: answer.status,
        }),
      );
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const saved = (body: { id: string; zone: string; text: string; createdAt: number }) => ({
  status: 200,
  body: { ...body, kind: 'note', photo: null, savedAt: T0 },
});

describe('the journal on the phone', () => {
  it('keeps a note while the hub is down, then sends it once', async () => {
    reply = () => 'offline';
    await addNote('basil_01', '  Hojas nuevas  ');
    const [waiting] = useJournal.getState().pending;
    expect(waiting).toMatchObject({ zone: 'basil_01', kind: 'note', text: 'Hojas nuevas' });
    expect(waiting?.failed).toBeUndefined();

    // The hub answers again.
    reply = (method, path, body) =>
      method === 'POST' && path === '/journal/notes'
        ? saved(body as { id: string; zone: string; text: string; createdAt: number })
        : { status: 200, body: { entries: [], events: [] } };
    await flushJournal();
    expect(useJournal.getState().pending).toEqual([]);
    expect(calls.filter((call) => call === 'POST /journal/notes')).toHaveLength(2);
    // And the plant's journal is fetched again.
    expect(calls).toContain('GET /journal/basil_01');
  });

  it('treats a hub behind nginx that cannot answer (502) as down, not as refused', async () => {
    reply = () => ({ status: 502 });
    await addNote('basil_01', 'Nota');
    expect(useJournal.getState().pending[0]?.failed).toBeUndefined();
  });

  it('says so when the hub refuses an entry, and keeps it until discarded', async () => {
    reply = () => ({ status: 413 });
    await addNote('basil_01', 'Nota');
    const [refused] = useJournal.getState().pending;
    expect(refused?.failed).toBe('La foto es demasiado grande.');
    // Not retried on its own.
    calls.length = 0;
    await flushJournal();
    expect(calls).toEqual([]);
    if (!refused) throw new Error('missing');
    const undo = await discardPending(refused);
    expect(useJournal.getState().pending).toEqual([]);
    reply = () => 'offline';
    await undo();
    expect(useJournal.getState().pending).toHaveLength(1);
  });

  it('shows the cached journal when the hub is down', async () => {
    reply = () => ({
      status: 200,
      body: {
        entries: [
          {
            id: '0b8f6a52-6f0e-4c7a-9f7e-2d1c3b4a5e6f',
            zone: 'basil_01',
            kind: 'note',
            text: 'Hola',
            photo: null,
            createdAt: T0,
            savedAt: T0,
          },
        ],
        events: [],
      },
    });
    await loadJournal('basil_01');
    expect(useJournal.getState().byZone['basil_01']?.status).toBe('ready');
    // The hub goes down: what was shown stays, marked as the phone's copy.
    reply = () => 'offline';
    await loadJournal('basil_01');
    const shown = useJournal.getState().byZone['basil_01'];
    expect(shown?.status).toBe('cached');
    expect(shown?.journal?.entries).toHaveLength(1);
  });
});
