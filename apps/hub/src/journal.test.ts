import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { API_PREFIX } from '@vitreo/shared';
import type { JournalEntry, PlantJournal } from '@vitreo/shared';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { backupNow } from './backup.ts';
import { ConfigOwner, defaultRules } from './configOwner.ts';
import { openDatabase } from './db/open.ts';
import type { NodeHubDatabase as HubDatabase } from './db/open.ts';
import * as t from './db/schema.ts';
import { ensurePlants } from './db/store.ts';
import { handleMessage } from './ingest.ts';
import {
  checkLatestBackup,
  DELETED_KEPT_MS,
  hasJpegMetadata,
  Journal,
  restorePhotos,
  stripJpegMetadata,
} from './journal.ts';
import { buildServer } from './server.ts';

/** The plants' journal (A8, D93): notes, photos without location, the plant's story. */

const DEVICE = 'sim';
const NOW = Date.parse('2026-10-12T10:00:00Z');
const ID = '0b8f6a52-6f0e-4c7a-9f7e-2d1c3b4a5e6f';

/** A small real JPEG, with an EXIF block carrying GPS put back in (as a phone camera does). */
async function photoWithGps(): Promise<Buffer> {
  const jpeg = await sharp({
    create: { width: 32, height: 24, channels: 3, background: '#6a8f5a' },
  })
    .jpeg()
    .toBuffer();
  const exif = Buffer.concat([
    Buffer.from('Exif\0\0', 'binary'),
    Buffer.from('MM\0*\0\0\0\x08GPSLatitude 40.4169 N GPSLongitude 3.7035 W', 'binary'),
  ]);
  const app1 = Buffer.alloc(4);
  app1.writeUInt16BE(0xffe1, 0);
  app1.writeUInt16BE(exif.length + 2, 2);
  return Buffer.concat([jpeg.subarray(0, 2), app1, exif, jpeg.subarray(2)]);
}

let db: HubDatabase;
let dir: string;
let journal: Journal;

beforeEach(() => {
  db = openDatabase(':memory:');
  ensurePlants(db, DEVICE, NOW);
  dir = mkdtempSync(path.join(tmpdir(), 'vitreo-journal-'));
  journal = new Journal(db, DEVICE, {
    photoDir: path.join(dir, 'photos'),
    database: ':memory:',
    backupDir: path.join(dir, 'backups'),
  });
});
afterEach(() => {
  db.$client.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('photos never carry a location', () => {
  it('strips EXIF (GPS included) and keeps the image intact', async () => {
    const photo = await photoWithGps();
    expect(hasJpegMetadata(photo)).toBe(true);
    expect(photo.includes('GPSLatitude')).toBe(true);
    const clean = stripJpegMetadata(photo);
    expect(hasJpegMetadata(clean)).toBe(false);
    expect(clean.includes('GPSLatitude')).toBe(false);
    // Still a valid JPEG of the same size.
    expect(await sharp(clean).metadata()).toMatchObject({ format: 'jpeg', width: 32, height: 24 });
  });

  it('refuses what is not a JPEG', () => {
    expect(() => stripJpegMetadata(Buffer.from('\x89PNG\r\n', 'binary'))).toThrow(/not a JPEG/);
    expect(() => stripJpegMetadata(Buffer.from([0xff, 0xd8, 0x00, 0x01]))).toThrow(/broken/);
  });
});

describe('the journal API', () => {
  const server = () =>
    buildServer(
      {
        db,
        owner: new ConfigOwner(db, DEVICE, {
          timeZone: 'Europe/Madrid',
          location: () => null,
          publish: () => undefined,
        }),
        device: DEVICE,
        timeZone: 'Europe/Madrid',
        seedLocation: { lat: 40.42, lng: -3.7 },
        startedAt: NOW,
        mqttConnected: () => true,
        now: () => NOW,
        journal,
      },
      { logLevel: 'silent' },
    );

  it('keeps a note once, however many times it is sent', async () => {
    const api = server();
    const note = {
      id: ID,
      zone: 'basil_01',
      text: '  Primeras hojas nuevas ',
      createdAt: NOW - 1000,
    };
    for (let i = 0; i < 2; i++) {
      const saved = await api.inject({
        method: 'POST',
        url: `${API_PREFIX}/journal/notes`,
        payload: note,
      });
      expect(saved.json<JournalEntry>()).toMatchObject({
        id: ID,
        kind: 'note',
        text: 'Primeras hojas nuevas',
      });
    }
    const plant = (
      await api.inject({ url: `${API_PREFIX}/journal/basil_01` })
    ).json<PlantJournal>();
    expect(plant.entries).toHaveLength(1);
    await api.close();
  });

  it('stores a photo without its metadata, and serves it', async () => {
    const api = server();
    const saved = await api.inject({
      method: 'PUT',
      url: `${API_PREFIX}/journal/${ID}/photo?zone=basil_01&createdAt=${NOW.toString()}&width=32&height=24&caption=Hoja%20amarilla`,
      headers: { 'content-type': 'image/jpeg' },
      payload: await photoWithGps(),
    });
    expect(saved.json<JournalEntry>()).toMatchObject({
      kind: 'photo',
      text: 'Hoja amarilla',
      photo: { width: 32, height: 24 },
    });
    const stored = readFileSync(path.join(dir, 'photos', `${ID}.jpg`));
    expect(hasJpegMetadata(stored)).toBe(false);
    const served = await api.inject({ url: `${API_PREFIX}/journal/${ID}/photo` });
    expect(served.headers['content-type']).toBe('image/jpeg');
    expect(served.rawPayload.includes('GPSLatitude')).toBe(false);
    await api.close();
  });

  it('refuses a photo that is not a JPEG, or too large', async () => {
    const api = server();
    const url = `${API_PREFIX}/journal/${ID}/photo?zone=basil_01&createdAt=1&width=1&height=1`;
    const png = await api.inject({
      method: 'PUT',
      url,
      headers: { 'content-type': 'image/jpeg' },
      payload: Buffer.from('\x89PNG\r\n\x1a\n', 'binary'),
    });
    expect(png.statusCode).toBe(400);
    const huge = await api.inject({
      method: 'PUT',
      url,
      headers: { 'content-type': 'image/jpeg' },
      payload: Buffer.alloc(1_600_000, 0xff),
    });
    expect(huge.statusCode).toBe(413);
    expect(readdirSync(dir)).not.toContain('photos');
    await api.close();
  });

  it('deletes softly (Deshacer), and purges a week later, photo included', async () => {
    const api = server();
    await api.inject({
      method: 'PUT',
      url: `${API_PREFIX}/journal/${ID}/photo?zone=basil_01&createdAt=${NOW.toString()}&width=32&height=24`,
      headers: { 'content-type': 'image/jpeg' },
      payload: await photoWithGps(),
    });
    await api.inject({ method: 'DELETE', url: `${API_PREFIX}/journal/${ID}` });
    expect(
      (await api.inject({ url: `${API_PREFIX}/journal/basil_01` })).json<PlantJournal>().entries,
    ).toEqual([]);
    expect((await api.inject({ url: `${API_PREFIX}/journal/${ID}/photo` })).statusCode).toBe(404);
    // Deshacer.
    await api.inject({ method: 'POST', url: `${API_PREFIX}/journal/${ID}/restore` });
    expect(
      (await api.inject({ url: `${API_PREFIX}/journal/basil_01` })).json<PlantJournal>().entries,
    ).toHaveLength(1);
    // Deleted again, and a week passes.
    journal.remove(ID, NOW);
    expect(journal.purge(NOW + DELETED_KEPT_MS - 1)).toBe(0);
    expect(journal.purge(NOW + DELETED_KEPT_MS + 1)).toBe(1);
    expect(readdirSync(path.join(dir, 'photos'))).toEqual([]);
    await api.close();
  });

  it("tells the plant's story: waterings, warnings and rule changes", () => {
    const owner = new ConfigOwner(db, DEVICE, {
      timeZone: 'Europe/Madrid',
      location: () => null,
      publish: () => undefined,
    });
    owner.announce(NOW - 3_600_000);
    const rules = defaultRules();
    owner.update(
      {
        ...rules,
        watering: rules.watering.map((r) =>
          r.zone === 'basil_01' ? { ...r, enabled: true, threshold: 0.35 } : r,
        ),
      },
      NOW - 1_800_000,
    );
    handleMessage(
      db,
      owner,
      DEVICE,
      'vitreo/sim/event',
      JSON.stringify({
        v: 1,
        ts: Math.floor(NOW / 1000) - 600,
        type: 'watering.started',
        source: 'automation',
        zone: 'basil_01',
        seconds: 5,
        reason: { kind: 'soil', moisture: 0.33, threshold: 0.35 },
      }),
      NOW,
    );
    db.insert(t.incidents)
      .values({
        device: DEVICE,
        key: 'thirsty:basil_01',
        type: 'thirsty',
        critical: false,
        zone: 'basil_01',
        title: 'La albahaca tiene sed',
        body: '',
        url: '/',
        openedAt: NOW - 7_200_000,
        resolvedAt: NOW - 500_000,
      })
      .run();
    const story = journal.plant('basil_01', NOW).events;
    expect(story).toContainEqual(
      expect.objectContaining({ kind: 'watering', source: 'automation', seconds: 5 }),
    );
    expect(story).toContainEqual(
      expect.objectContaining({ kind: 'alert', title: 'La albahaca tiene sed' }),
    );
    expect(story).toContainEqual(
      expect.objectContaining({
        kind: 'rule',
        enabled: true,
        threshold: 0.35,
        before: { enabled: false, threshold: 0.4 },
      }),
    );
  });

  it('shows events of a type it does not know as a neutral line, in the journal of their pot or of the greenhouse (D108)', () => {
    const owner = new ConfigOwner(db, DEVICE, {
      timeZone: 'Europe/Madrid',
      location: () => null,
      publish: () => undefined,
    });
    const ts = Math.floor(NOW / 1000) - 600;
    const receive = (event: Record<string, unknown>) =>
      handleMessage(db, owner, DEVICE, 'vitreo/sim/event', JSON.stringify(event), NOW);
    receive({ v: 1, ts, type: 'filter.clogged', source: 'safety', zone: 'basil_01', bar: 1.4 });
    receive({ v: 1, ts: ts + 1, type: 'door.opened' });
    // Stored as events with their type, not with the invalid messages.
    expect(db.select().from(t.rejected).all()).toHaveLength(0);
    expect(db.select({ type: t.events.type, zone: t.events.zone }).from(t.events).all()).toEqual([
      { type: 'filter.clogged', zone: 'basil_01' },
      { type: 'door.opened', zone: null },
    ]);
    expect(journal.plant('basil_01', NOW).events).toEqual([
      { kind: 'device', ts, type: 'filter.clogged' },
    ]);
    expect(journal.plant('greenhouse', NOW).events).toEqual([
      { kind: 'device', ts: ts + 1, type: 'door.opened' },
    ]);
    expect(journal.plant('tomato_01', NOW).events).toEqual([]);
  });

  it('backs photos up next to the database, restores them, and says how much it all takes', async () => {
    journal.addPhoto(
      ID,
      { zone: 'basil_01', createdAt: NOW, width: 32, height: 24 },
      await photoWithGps(),
      NOW,
    );
    expect(journal.backupPhotos()).toEqual({ copied: 1, removed: 0 });
    expect(journal.backupPhotos()).toEqual({ copied: 0, removed: 0 });
    rmSync(path.join(dir, 'photos'), { recursive: true });
    expect(restorePhotos(path.join(dir, 'backups'), path.join(dir, 'photos'))).toBe(1);
    const storage = journal.storage(NOW);
    expect(storage.photos.count).toBe(1);
    expect(storage.photosLast30DaysBytes).toBe(storage.photos.bytes);
    expect(storage.backupsBytes).toBeGreaterThan(0);
  });
});

describe('the photos in the backups', () => {
  const backups = () => path.join(dir, 'backups');
  const photos = () => path.join(dir, 'photos');
  const SECOND_ID = '1c9e7b63-7f1f-4d8b-8a8f-3e2d4c5b6a70';

  async function photo(id: string) {
    journal.addPhoto(
      id,
      { zone: 'basil_01', createdAt: NOW, width: 32, height: 24 },
      await photoWithGps(),
      NOW,
    );
  }

  it('a photo lost from the volume stays in the backups, and a restore brings it back', async () => {
    await photo(ID);
    backupNow(db, backups(), '2026-10-12');
    journal.backupPhotos();
    rmSync(journal.photoPath(ID));
    // The next night: the live database still refers to it, so it stays.
    expect(journal.backupPhotos()).toEqual({ copied: 0, removed: 0 });
    // Even with the whole folder gone.
    rmSync(photos(), { recursive: true });
    expect(journal.backupPhotos()).toEqual({ copied: 0, removed: 0 });
    expect(restorePhotos(backups(), photos())).toBe(1);
    expect(journal.photoFile(ID)).not.toBeNull();
    expect(checkLatestBackup(backups())).toEqual({ day: '2026-10-12', photos: 1, missing: 0 });
  });

  it('a deleted photo stays while a kept backup refers to it, then goes', async () => {
    await photo(ID);
    await photo(SECOND_ID);
    backupNow(db, backups(), '2026-10-12');
    journal.backupPhotos();
    journal.remove(SECOND_ID, NOW);
    expect(journal.purge(NOW + DELETED_KEPT_MS + 1)).toBe(1);
    // Gone from the live database and the volume; the backup still has it.
    expect(journal.backupPhotos()).toEqual({ copied: 0, removed: 0 });
    expect(readdirSync(path.join(backups(), 'photos'))).toHaveLength(2);
    // Once no kept backup refers to it either, it leaves the mirror.
    rmSync(path.join(backups(), 'hub-2026-10-12.sqlite'));
    backupNow(db, backups(), '2026-10-20');
    expect(journal.backupPhotos()).toEqual({ copied: 0, removed: 1 });
  });

  it('says when the newest backup refers to photos that are not in it', async () => {
    expect(checkLatestBackup(backups())).toEqual({ day: null, photos: 0, missing: 0 });
    await photo(ID);
    backupNow(db, backups(), '2026-10-12');
    expect(checkLatestBackup(backups())).toEqual({ day: '2026-10-12', photos: 1, missing: 1 });
    journal.backupPhotos();
    expect(checkLatestBackup(backups()).missing).toBe(0);
  });

  it('takes a backup on demand only from inside the hub', async () => {
    const api = buildServer(
      {
        db,
        owner: new ConfigOwner(db, DEVICE, {
          timeZone: 'Europe/Madrid',
          location: () => null,
          publish: () => undefined,
        }),
        device: DEVICE,
        timeZone: 'Europe/Madrid',
        seedLocation: { lat: 40.42, lng: -3.7 },
        startedAt: NOW,
        mqttConnected: () => true,
        now: () => NOW,
        journal,
        backup: () => ({
          file: 'hub-2026-10-12.sqlite',
          copied: 0,
          removed: 0,
          day: '2026-10-12',
          photos: 0,
          missing: 0,
        }),
      },
      { logLevel: 'silent' },
    );
    const url = `${API_PREFIX}/backup`;
    expect((await api.inject({ method: 'POST', url })).statusCode).toBe(200);
    // Through nginx (the phone) or Docker's published port (the PC): refused.
    const outside = await api.inject({ method: 'POST', url, remoteAddress: '172.18.0.5' });
    expect(outside.statusCode).toBe(403);
    const storage = await api.inject({ url: `${API_PREFIX}/storage` });
    expect(storage.json()).toMatchObject({ backup: { day: null, photos: 0, missing: 0 } });
  });
});

describe('tags, greenhouse notes and chapters (A12)', () => {
  const api = () =>
    buildServer(
      {
        db,
        owner: new ConfigOwner(db, DEVICE, {
          timeZone: 'Europe/Madrid',
          location: () => null,
          publish: () => undefined,
        }),
        device: DEVICE,
        timeZone: 'Europe/Madrid',
        seedLocation: { lat: 40.42, lng: -3.7 },
        startedAt: NOW,
        mqttConnected: () => true,
        now: () => NOW,
        journal,
      },
      { logLevel: 'silent' },
    );

  it('a tag alone is a note ("Regada a mano"), and an empty note is not', async () => {
    const server = api();
    const saved = await server.inject({
      method: 'POST',
      url: `${API_PREFIX}/journal/notes`,
      payload: { id: ID, zone: 'basil_01', text: '', tags: ['watered'], createdAt: NOW },
    });
    expect(saved.json<JournalEntry>()).toMatchObject({ text: null, tags: ['watered'] });
    const empty = await server.inject({
      method: 'POST',
      url: `${API_PREFIX}/journal/notes`,
      payload: { id: crypto.randomUUID(), zone: 'basil_01', text: ' ', createdAt: NOW },
    });
    expect(empty.statusCode).toBe(400);
  });

  it('the greenhouse has its own journal, with its own tags', async () => {
    const server = api();
    await server.inject({
      method: 'POST',
      url: `${API_PREFIX}/journal/notes`,
      payload: {
        id: ID,
        zone: 'greenhouse',
        text: 'Tubo de la albahaca suelto',
        tags: ['fault', 'leak'],
        createdAt: NOW,
      },
    });
    const journal = (await server.inject({ url: `${API_PREFIX}/journal/greenhouse` })).json<{
      entries: JournalEntry[];
    }>();
    expect(journal.entries).toEqual([
      expect.objectContaining({ zone: 'greenhouse', tags: ['fault', 'leak'] }),
    ]);
  });

  it('a new plant in a pot keeps the last one as a chapter, and says so in the story', async () => {
    const server = api();
    await server.inject({
      method: 'PATCH',
      url: `${API_PREFIX}/plants/basil_01`,
      payload: { name: 'Pepa', sownAt: '2026-09-01' },
    });
    const started = await server.inject({
      method: 'POST',
      url: `${API_PREFIX}/plants/basil_01/chapter`,
      payload: { name: null, sownAt: '2026-10-12' },
    });
    expect(started.json()).toMatchObject({ zone: 'basil_01', name: null, since: NOW });
    expect((await server.inject({ url: `${API_PREFIX}/plants/basil_01/chapters` })).json()).toEqual(
      [
        {
          zone: 'basil_01',
          kind: 'basil',
          name: 'Pepa',
          sownAt: '2026-09-01',
          startedAt: null,
          endedAt: NOW,
        },
      ],
    );
    const story = (
      await server.inject({ url: `${API_PREFIX}/journal/basil_01` })
    ).json<PlantJournal>();
    expect(story.events).toContainEqual({
      kind: 'chapter',
      at: NOW,
      before: { name: 'Pepa', sownAt: '2026-09-01' },
    });
  });
});
