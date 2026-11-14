import type { PushPrefs, PushSubscriptionJson, PushType } from '@vitreo/shared';
import { eq } from 'drizzle-orm';

import type { HubDatabase } from './db/types.ts';
import * as t from './db/schema.ts';

/**
 * Web push (A7, D91). The VAPID keys live only in .env; the subscriptions
 * (one per browser that turned warnings on) in the hub's database. The e2e
 * hub never sends anything: it keeps what it would send in memory, so tests
 * can never reach a real phone.
 *
 * This is the part that only needs the database; the delivery itself
 * (web-push, Node) is push.ts. The public demo uses this one, which
 * records and never sends.
 */
export interface PushMessage {
  title: string;
  body: string;
  /** Same tag = it replaces the previous notification of that situation. */
  tag: string;
  /** Where tapping it opens the app. */
  url: string;
  /** Sound and vibrate (a new warning, a reminder); false for "resuelto". */
  renotify: boolean;
  critical: boolean;
}

export interface Sent {
  endpoint: string;
  message: PushMessage;
}

/** Hands one notification to the browser's push service; throws on failure. */
export type Deliver = (
  target: { endpoint: string; keys: { p256dh: string; auth: string } },
  payload: string,
  options: { TTL: number; urgency: 'high' | 'normal' },
) => Promise<unknown>;

export interface PushCoreOptions {
  /** The VAPID public key, or null without keys. */
  publicKey: string | null;
  /** The e2e hub and the demo: record, never send. */
  dryRun: boolean;
  /** How to send (web-push); null without keys. */
  deliver: Deliver | null;
}

export class PushCore {
  /** What the e2e hub would have sent. */
  readonly outbox: Sent[] = [];

  constructor(
    private readonly db: HubDatabase,
    private readonly device: string,
    private readonly options: PushCoreOptions,
    private readonly log: (message: string) => void,
  ) {}

  get publicKey(): string | null {
    return this.options.publicKey;
  }

  save(subscription: PushSubscriptionJson, prefs: PushPrefs, now: number): void {
    const values = {
      device: this.device,
      p256dh: subscription.keys.p256dh,
      auth: subscription.keys.auth,
      types: JSON.stringify(prefs.types),
      updatedAt: now,
    };
    this.db
      .insert(t.pushSubscriptions)
      .values({ endpoint: subscription.endpoint, createdAt: now, ...values })
      .onConflictDoUpdate({ target: t.pushSubscriptions.endpoint, set: values })
      .run();
  }

  remove(endpoint: string): void {
    this.db.delete(t.pushSubscriptions).where(eq(t.pushSubscriptions.endpoint, endpoint)).run();
  }

  prefsOf(endpoint: string): PushPrefs | null {
    const row = this.db
      .select()
      .from(t.pushSubscriptions)
      .where(eq(t.pushSubscriptions.endpoint, endpoint))
      .get();
    return row ? { types: JSON.parse(row.types) as PushType[] } : null;
  }

  /** To every browser that wants this type (or to one, for "Probar aviso"). */
  async send(message: PushMessage, type: PushType | null, only?: string): Promise<number> {
    const rows = this.db
      .select()
      .from(t.pushSubscriptions)
      .where(eq(t.pushSubscriptions.device, this.device))
      .all()
      .filter((row) => (only ? row.endpoint === only : true))
      .filter((row) => type === null || (JSON.parse(row.types) as string[]).includes(type));
    let sent = 0;
    for (const row of rows) {
      if (this.options.dryRun) {
        this.outbox.push({ endpoint: row.endpoint, message });
        sent++;
        continue;
      }
      const deliver = this.options.deliver;
      if (!deliver) continue;
      try {
        await deliver(
          { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
          JSON.stringify(message),
          // A warning older than a day is not news; critical ones go first.
          { TTL: 24 * 3600, urgency: message.critical ? 'high' : 'normal' },
        );
        sent++;
      } catch (error) {
        const status = (error as { statusCode?: number }).statusCode;
        // Gone (the browser unsubscribed or the app was uninstalled): forget it.
        if (status === 404 || status === 410) this.remove(row.endpoint);
        this.log(`push failed (${String(status ?? (error as Error).message)})`);
      }
    }
    return sent;
  }
}
