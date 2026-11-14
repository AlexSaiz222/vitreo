/**
 * A tiny IndexedDB key–value store (A8): the journal's cache and the entries
 * waiting for the hub, which may hold photos (too big for localStorage).
 * If IndexedDB is unavailable (a private window), it says so by failing,
 * and the callers keep things in memory for the visit.
 */
const DB_NAME = 'vitreo';
const VERSION = 1;
export type StoreName = 'journal' | 'pending';

let opening: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  opening ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, VERSION);
    request.onupgradeneeded = () => {
      for (const name of ['journal', 'pending'] as const) {
        if (!request.result.objectStoreNames.contains(name)) request.result.createObjectStore(name);
      }
    };
    request.onsuccess = () => {
      resolve(request.result);
    };
    request.onerror = () => {
      opening = null;
      reject(request.error ?? new Error('IndexedDB unavailable'));
    };
  });
  return opening;
}

async function run<T>(
  store: StoreName,
  mode: IDBTransactionMode,
  action: (objects: IDBObjectStore) => IDBRequest,
): Promise<T> {
  const db = await open();
  return new Promise<T>((resolve, reject) => {
    const transaction = db.transaction(store, mode);
    const request = action(transaction.objectStore(store));
    transaction.oncomplete = () => {
      resolve(request.result as T);
    };
    transaction.onerror = () => {
      reject(transaction.error ?? new Error('IndexedDB failed'));
    };
  });
}

export const idbGet = <T>(store: StoreName, key: string) =>
  run<T | undefined>(store, 'readonly', (objects) => objects.get(key));

export const idbSet = (store: StoreName, key: string, value: unknown) =>
  run<IDBValidKey>(store, 'readwrite', (objects) => objects.put(value, key));

export const idbDelete = (store: StoreName, key: string) =>
  run<undefined>(store, 'readwrite', (objects) => objects.delete(key));

export const idbAll = <T>(store: StoreName) =>
  run<T[]>(store, 'readonly', (objects) => objects.getAll());
