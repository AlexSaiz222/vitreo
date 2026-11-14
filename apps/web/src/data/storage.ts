import { hubStorage } from '@vitreo/shared';
import type { HubStorage } from '@vitreo/shared';
import { useEffect, useState } from 'react';

import { hubGet, useHub } from './hub.ts';

/** What the hub keeps on disk (A8), fetched while Ajustes is open and the hub answers. */
export function useHubStorage(): HubStorage | null {
  const up = useHub((state) => state.status === 'up');
  const [storage, setStorage] = useState<HubStorage | null>(null);
  useEffect(() => {
    if (!up) return;
    let live = true;
    void hubGet('/storage', hubStorage).then((result) => {
      if (live && result.ok) setStorage(result.value);
    });
    return () => {
      live = false;
    };
  }, [up]);
  return storage;
}

const megabytes = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 1 });
const NB = String.fromCharCode(0xa0);

/** "320 KB", "12,3 MB", "1,2 GB". */
export function formatBytes(bytes: number): string {
  if (bytes < 1_000_000) return `${Math.round(bytes / 1000).toString()}${NB}KB`;
  if (bytes < 1_000_000_000) return `${megabytes.format(bytes / 1_000_000)}${NB}MB`;
  return `${megabytes.format(bytes / 1_000_000_000)}${NB}GB`;
}

/** "Fotos 9,8 MB (34) · datos 12 MB · copias 80 MB". */
export function storageText(storage: HubStorage): string {
  const photos =
    storage.photos.count === 0
      ? 'sin fotos'
      : `fotos ${formatBytes(storage.photos.bytes)} (${storage.photos.count.toString()})`;
  return `Datos ${formatBytes(storage.databaseBytes)} · ${photos} · copias ${formatBytes(storage.backupsBytes)}`;
}
