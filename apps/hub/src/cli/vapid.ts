import { generateVapidKeys } from '../push.ts';

/**
 * Prints a new VAPID key pair for web push (A7), to paste into .env once:
 *   pnpm hub:vapid
 * The keys stay in .env only (never in the repository). Changing them later
 * means every device has to turn its warnings on again.
 */
const { publicKey, privateKey } = generateVapidKeys();
console.log(`HUB_VAPID_PUBLIC_KEY=${publicKey}`);
console.log(`HUB_VAPID_PRIVATE_KEY=${privateKey}`);
