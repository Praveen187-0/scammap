// Web Push for area alerts. The browser gives us a push endpoint and keys; we keep them with the chosen area and
// language only, and delete them when the person switches alerts off or the endpoint stops working.
import { createHash } from "node:crypto";
import webpush from "web-push";
import type { Pool } from "../db/db.js";
import type { LiveBus } from "../live/bus.js";
import { logError, logInfo } from "../log.js";

export interface PushSubscriptionJson {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export class PushService {
  publicKey = "";
  sent = 0;
  failed = 0;

  constructor(private readonly pool: Pool, private readonly subject: string) {}

  /** VAPID keys from the environment, else generated once and kept in the database. */
  async init(env: { publicKey?: string; privateKey?: string }): Promise<void> {
    let pub = env.publicKey ?? "";
    let priv = env.privateKey ?? "";
    if (!pub || !priv) {
      const rows = (await this.pool.query<{ key: string; value: string }>("SELECT key, value FROM app_settings WHERE key IN ('vapid_public', 'vapid_private')")).rows;
      pub = rows.find((r) => r.key === "vapid_public")?.value ?? "";
      priv = rows.find((r) => r.key === "vapid_private")?.value ?? "";
      if (!pub || !priv) {
        const k = webpush.generateVAPIDKeys();
        pub = k.publicKey;
        priv = k.privateKey;
        await this.pool.query("INSERT INTO app_settings (key, value) VALUES ('vapid_public', $1), ('vapid_private', $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", [pub, priv]);
        logInfo("push: generated VAPID keys");
      }
    }
    webpush.setVapidDetails(this.subject, pub, priv);
    this.publicKey = pub;
  }

  static hash(endpoint: string): string {
    return createHash("sha256").update(endpoint).digest("hex").slice(0, 40);
  }

  async subscribe(sub: PushSubscriptionJson, pincode: string, lang: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO push_subs (endpoint_hash, subscription, pincode, lang) VALUES ($1, $2, $3, $4)
       ON CONFLICT (endpoint_hash) DO UPDATE SET subscription = EXCLUDED.subscription, pincode = EXCLUDED.pincode, lang = EXCLUDED.lang`,
      [PushService.hash(sub.endpoint), JSON.stringify(sub), pincode, lang],
    );
  }

  async unsubscribe(endpoint: string): Promise<void> {
    await this.pool.query("DELETE FROM push_subs WHERE endpoint_hash = $1", [PushService.hash(endpoint)]);
  }

  async count(): Promise<number> {
    return (await this.pool.query<{ c: number }>("SELECT count(*)::int AS c FROM push_subs")).rows[0]?.c ?? 0;
  }

  /** Only alerts (unusual activity) are pushed: never individual reports. */
  attach(bus: LiveBus): () => void {
    return bus.subscribe((e) => {
      if (e.type !== "alert" || (e as { replay?: boolean }).replay) return;
      void this.sendArea(e.pincode, (lang) => ({
        title: lang === "hi" ? `स्कैम अलर्ट: ${e.locality_hi}` : `Scam alert: ${e.locality}`,
        body: lang === "hi" ? e.alert.message_hi : e.alert.message_en,
        url: "/#alerts",
        tag: `alert-${e.pincode}-${e.alert.type}`,
      }));
    });
  }

  async sendArea(pincode: string, make: (lang: string) => Record<string, string>): Promise<void> {
    const subs = (await this.pool.query<{ endpoint_hash: string; subscription: PushSubscriptionJson; lang: string }>(
      "SELECT endpoint_hash, subscription, lang FROM push_subs WHERE pincode = $1",
      [pincode],
    )).rows;
    await Promise.all(subs.map(async (s) => {
      try {
        await webpush.sendNotification(s.subscription, JSON.stringify(make(s.lang)), { TTL: 3600, urgency: "high" });
        this.sent++;
      } catch (err) {
        this.failed++;
        const code = (err as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) await this.pool.query("DELETE FROM push_subs WHERE endpoint_hash = $1", [s.endpoint_hash]).catch(() => undefined);
        else logError("push send failed", err);
      }
    }));
  }
}
