import { incidentList, PUSH_TYPES, pushKey } from '@vitreo/shared';
import type { Incident, PushType } from '@vitreo/shared';
import { z } from 'zod';
import { create } from 'zustand';

import { hubGet, hubPut, hubUrl } from './hub.ts';
import { hubFetch } from './hubFetch.ts';

/**
 * Web push on this device (A7, D91). The browser's permission is asked only
 * when the person taps "Activar avisos", never on load. The subscription
 * goes to the hub, which sends the notifications; with the PC off or
 * asleep, none is sent (Ajustes › Avisos says so).
 */
export type PushState =
  /** Not known yet (asking the browser). */
  | 'checking'
  /** This browser cannot receive push (e.g. a phone browser without installing the app). */
  | 'unsupported'
  /** The person blocked notifications for Vitreo in this browser. */
  | 'denied'
  /** Supported, not turned on here. */
  | 'off'
  | 'on';

interface PushStore {
  state: PushState;
  /** The types this device wants; all of them until changed. */
  types: PushType[];
  busy: boolean;
  /** The last action's outcome, in words. */
  message: { text: string; tone: 'good' | 'attention' } | null;
  incidents: Incident[] | null;
}

const PREFS_KEY = 'vitreo.push.types';
/** The types this device has been offered, so a new one starts on (as the hub's migration does). */
const KNOWN_KEY = 'vitreo.push.known';
/** Types added after A7: a device that chose before them has not seen them. */
const ADDED_LATER: readonly PushType[] = ['frost_forecast'];

const typeList = z.array(z.enum(PUSH_TYPES));

export function storedTypes(): PushType[] {
  try {
    const chosen = typeList.safeParse(JSON.parse(localStorage.getItem(PREFS_KEY) ?? 'null'));
    if (!chosen.success) return [...PUSH_TYPES];
    const known = typeList.safeParse(JSON.parse(localStorage.getItem(KNOWN_KEY) ?? 'null'));
    const seen = known.success
      ? known.data
      : PUSH_TYPES.filter((type) => !ADDED_LATER.includes(type));
    const types = [...chosen.data, ...PUSH_TYPES.filter((type) => !seen.includes(type))];
    localStorage.setItem(PREFS_KEY, JSON.stringify(types));
    localStorage.setItem(KNOWN_KEY, JSON.stringify(PUSH_TYPES));
    return types;
  } catch {
    return [...PUSH_TYPES];
  }
}

export const usePush = create<PushStore>()(() => ({
  state: 'checking',
  types: typeof localStorage === 'undefined' ? [...PUSH_TYPES] : storedTypes(),
  busy: false,
  message: null,
  incidents: null,
}));

const supported = () =>
  typeof window !== 'undefined' &&
  'serviceWorker' in navigator &&
  'PushManager' in window &&
  'Notification' in window;

async function registration(): Promise<ServiceWorkerRegistration | null> {
  if (!supported()) return null;
  // In development there is no service worker: no push either.
  const existing = await navigator.serviceWorker.getRegistration();
  return existing ? navigator.serviceWorker.ready : null;
}

/** What this device can do now. */
export async function checkPush(): Promise<void> {
  if (!supported()) {
    usePush.setState({ state: 'unsupported' });
    return;
  }
  if (Notification.permission === 'denied') {
    usePush.setState({ state: 'denied' });
    return;
  }
  const reg = await registration();
  if (!reg) {
    usePush.setState({ state: 'unsupported' });
    return;
  }
  const subscription = await reg.pushManager.getSubscription();
  usePush.setState({ state: subscription && Notification.permission === 'granted' ? 'on' : 'off' });
}

function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const padded = `${base64}${'='.repeat((4 - (base64.length % 4)) % 4)}`
    .replaceAll('-', '+')
    .replaceAll('_', '/');
  const binary = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

const registered = z.object({ types: z.array(z.enum(PUSH_TYPES)) });

async function register(subscription: PushSubscription, types: PushType[]): Promise<boolean> {
  const json = subscription.toJSON();
  const result = await hubPut('/push/subscription', registered, {
    subscription: { endpoint: json.endpoint, keys: json.keys },
    prefs: { types },
  });
  return result.ok;
}

/** "Activar avisos": asks permission (only now), subscribes, tells the hub. */
export async function enablePush(): Promise<void> {
  usePush.setState({ busy: true, message: null });
  try {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      usePush.setState({ state: permission === 'denied' ? 'denied' : 'off' });
      return;
    }
    const reg = await registration();
    const key = await hubGet('/push/key', pushKey);
    if (!reg || !key.ok) {
      usePush.setState({
        message: {
          text: key.ok
            ? 'Este navegador no puede recibir avisos.'
            : 'El hub no puede enviar avisos ahora: no responde o le faltan las claves (VAPID en .env).',
          tone: 'attention',
        },
      });
      return;
    }
    const subscription =
      (await reg.pushManager.getSubscription()) ??
      (await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: base64ToBytes(key.value.publicKey),
      }));
    const ok = await register(subscription, usePush.getState().types);
    usePush.setState(
      ok
        ? { state: 'on', message: { text: 'Avisos activados en este dispositivo.', tone: 'good' } }
        : {
            message: {
              text: 'No se han activado: el hub no responde. Inténtalo cuando vuelva.',
              tone: 'attention',
            },
          },
    );
  } catch {
    usePush.setState({
      message: {
        text: 'No se han podido activar los avisos en este navegador.',
        tone: 'attention',
      },
    });
  } finally {
    usePush.setState({ busy: false });
  }
}

async function endpoint(): Promise<string | null> {
  const reg = await registration();
  return (await reg?.pushManager.getSubscription())?.endpoint ?? null;
}

async function send(
  method: 'POST' | 'DELETE',
  path: string,
  body: unknown,
): Promise<Response | null> {
  try {
    return await hubFetch(hubUrl(path), {
      method,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5_000),
    });
  } catch {
    return null;
  }
}

/** "Desactivar avisos": forgets the subscription here and in the hub. */
export async function disablePush(): Promise<void> {
  usePush.setState({ busy: true, message: null });
  const reg = await registration();
  const subscription = await reg?.pushManager.getSubscription();
  if (subscription) {
    await send('DELETE', '/push/subscription', { endpoint: subscription.endpoint });
    await subscription.unsubscribe();
  }
  usePush.setState({ state: 'off', busy: false, message: null });
}

/** Which types this device wants; saved here, and in the hub if on. */
export async function setPushTypes(types: PushType[]): Promise<void> {
  usePush.setState({ types, message: null });
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(types));
    localStorage.setItem(KNOWN_KEY, JSON.stringify(PUSH_TYPES));
  } catch {
    // Kept for this visit only.
  }
  if (usePush.getState().state !== 'on') return;
  const reg = await registration();
  const subscription = await reg?.pushManager.getSubscription();
  if (!subscription) return;
  const ok = await register(subscription, types);
  if (!ok) {
    usePush.setState({
      message: {
        text: 'No se ha guardado en el hub: no responde. Se guardará al volver a activarlos.',
        tone: 'attention',
      },
    });
  }
}

/** "Probar aviso": the hub sends one to this device now. */
export async function testPush(): Promise<void> {
  usePush.setState({ busy: true, message: null });
  const where = await endpoint();
  const response = where ? await send('POST', '/push/test', { endpoint: where }) : null;
  usePush.setState({
    busy: false,
    message:
      response?.ok === true
        ? { text: 'Enviado: debería llegar en unos segundos.', tone: 'good' }
        : {
            text:
              response === null
                ? 'No se ha enviado: el hub no responde.'
                : 'No se ha enviado: este dispositivo no está suscrito en el hub. Desactiva y vuelve a activar.',
            tone: 'attention',
          },
  });
}

/** The latest warnings the hub kept (open ones first). */
export async function loadIncidents(): Promise<void> {
  const result = await hubGet('/alerts', incidentList);
  if (result.ok) usePush.setState({ incidents: result.value });
}
