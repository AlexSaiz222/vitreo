import webpush from 'web-push';

import type { HubDatabase } from './db/types.ts';
import { PushCore } from './pushCore.ts';

/** Web push on the hub (A7, D91): PushCore, delivering with web-push and the VAPID keys. */

export type { PushMessage, Sent } from './pushCore.ts';

export interface PushOptions {
  keys: { publicKey: string; privateKey: string; subject: string } | null;
  /** The e2e hub: record, never send. */
  dryRun: boolean;
}

export class PushSender extends PushCore {
  constructor(
    db: HubDatabase,
    device: string,
    options: PushOptions,
    log: (message: string) => void,
  ) {
    const keys = options.keys;
    if (keys) webpush.setVapidDetails(keys.subject, keys.publicKey, keys.privateKey);
    super(
      db,
      device,
      {
        publicKey: keys?.publicKey ?? null,
        dryRun: options.dryRun,
        deliver: keys
          ? (target, payload, delivery) => webpush.sendNotification(target, payload, delivery)
          : null,
      },
      log,
    );
  }
}

/** Generates a VAPID key pair once (`pnpm hub:vapid`), for .env. */
export const generateVapidKeys = (): { publicKey: string; privateKey: string } =>
  webpush.generateVAPIDKeys();
