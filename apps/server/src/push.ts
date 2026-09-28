import { createHash } from "node:crypto";
import webpush from "web-push";
import { z } from "zod";
import type { Config } from "./config.ts";
import type { Store } from "./db.ts";
import { AppError } from "./errors.ts";
import { backgroundFailure } from "./log.ts";
import { keptSecret } from "./server-keys.ts";

// Browser push services. The server only ever posts to these hosts.
const PUSH_HOSTS = [
  ".googleapis.com",
  ".push.services.mozilla.com",
  ".push.apple.com",
  ".notify.windows.com",
];
export const pushSubscriptionSchema = z.object({
  endpoint: z
    .url()
    .max(2048)
    .refine((value) => {
      const url = new URL(value);
      return (
        url.protocol === "https:" && PUSH_HOSTS.some((host) => `.${url.hostname}`.endsWith(host))
      );
    }, "Unsupported push service"),
  keys: z.object({ p256dh: z.string().min(1).max(200), auth: z.string().min(1).max(100) }),
});
type Subscription = z.infer<typeof pushSubscriptionSchema> & { id: string; createdAt: string };
export interface PushMessage {
  title: string;
  body: string;
  tag?: string;
  url?: string;
}

/** Web push to installed apps and browsers that opted in. */
export class PushService {
  private constructor(
    private readonly db: Store,
    readonly publicKey: string,
    private readonly privateKey: string,
    private readonly subject: string,
    private readonly send: typeof webpush.sendNotification,
  ) {}
  /** VAPID keys come from the environment or are generated once and kept (see keptSecret). */
  static async create(db: Store, config: Config, send = webpush.sendNotification) {
    const keys: { publicKey: string; privateKey: string } =
      process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY
        ? { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY }
        : JSON.parse(
            await keptSecret(db, {
              name: "vapid.json",
              dataDir: config.dataDir,
              encryptionKey: config.encryptionKey,
              make: () => JSON.stringify(webpush.generateVAPIDKeys()),
            }),
          );
    const subject =
      process.env.VAPID_SUBJECT ||
      (config.publicUrl.startsWith("https://") ? config.publicUrl : "mailto:openmuse@example.com");
    return new PushService(db, keys.publicKey, keys.privateKey, subject, send);
  }
  private id(endpoint: string) {
    return createHash("sha256").update(endpoint).digest("hex");
  }
  async subscribe(owner: string, raw: unknown) {
    const parsed = pushSubscriptionSchema.parse(raw);
    if ((await this.db.list(owner, "push-subscriptions")).length >= 20)
      throw new AppError("Too many devices have notifications on. Turn some off first.", 409);
    const value: Subscription = {
      ...parsed,
      id: this.id(parsed.endpoint),
      createdAt: new Date().toISOString(),
    };
    await this.db.put(owner, "push-subscriptions", value);
    return { ok: true };
  }
  async unsubscribe(owner: string, endpoint: string) {
    await this.db.remove(owner, "push-subscriptions", this.id(endpoint));
    return { ok: true };
  }
  /** Best effort: a failed push never fails the work that triggered it. */
  async notify(owner: string, message: PushMessage) {
    const subscriptions = await this.db.list<Subscription>(owner, "push-subscriptions");
    const payload = JSON.stringify({
      title: message.title.slice(0, 120),
      body: message.body.slice(0, 300),
      tag: message.tag,
      url: message.url ?? "/",
    });
    await Promise.all(
      subscriptions.map(async (subscription) => {
        try {
          await this.send({ endpoint: subscription.endpoint, keys: subscription.keys }, payload, {
            TTL: 24 * 60 * 60,
            vapidDetails: {
              subject: this.subject,
              publicKey: this.publicKey,
              privateKey: this.privateKey,
            },
          });
        } catch (error) {
          const status =
            error && typeof error === "object" && "statusCode" in error
              ? Number(error.statusCode)
              : 0;
          // The browser unsubscribed or the app was removed.
          if (status === 404 || status === 410)
            await this.db.remove(owner, "push-subscriptions", subscription.id);
          else backgroundFailure("push notification", error);
        }
      }),
    );
  }
}
